import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import { DemoLLMProvider } from '../llm/provider.js';
import ContextEngine from '../context/engine.js';
import Evaluator from '../harness/evaluator.js';
import PlannerAgent from '../agents/planner.js';
import ResearcherAgent from '../agents/researcher.js';
import AssetAgent from '../agents/asset.js';
import CoderAgent from '../agents/coder.js';
import PatchCoderAgent from '../agents/patch-coder.js';
import TesterAgent from '../agents/tester.js';
import CriticAgent from '../agents/critic.js';
import { ensureRenderableOutput } from '../artifacts/preview.js';
import { collectArtifacts } from '../artifacts/manifest.js';
import { evaluateQuality } from '../harness/metrics.js';
import { createArtifactPublisher } from './artifactPublisher.js';
import { resolveArtifactContract } from './artifactContract.js';
import { extractPlanJson, resolveIntentPlan } from './intentRouter.js';
import { validateArtifact } from './artifactValidator.js';

const EXECUTABLE_AGENTS = new Set(['researcher', 'asset', 'coder', 'tester', 'critic']);
const CANONICAL_AGENT_ORDER = ['researcher', 'asset', 'coder', 'tester', 'critic'];

export default class Pipeline {
    constructor(broadcast) {
        this.broadcast = broadcast || (() => { });
        this.llmProvider = new DemoLLMProvider();
        this.contextEngine = new ContextEngine();
        this.evaluator = new Evaluator();
        this.activeRuns = new Map();

        const map = config.agentLLMMap;
        this.agents = {
            planner: new PlannerAgent(this.llmProvider, map.planner),
            researcher: new ResearcherAgent(this.llmProvider, map.researcher),
            asset: new AssetAgent(this.llmProvider, map.asset),
            coder: new CoderAgent(this.llmProvider, map.coder),
            patch_coder: new PatchCoderAgent(this.llmProvider, map.coder),
            tester: new TesterAgent(this.llmProvider, map.tester),
            critic: new CriticAgent(this.llmProvider, map.critic),
        };

        this.artifactPublisher = createArtifactPublisher((event, data) => this._broadcast(event, data));
    }

    async run(userInput, customModels = {}, outputMode = 'website') {
        const runId = uuidv4();
        const startTime = Date.now();
        const steps = [];
        const logs = [];
        const modeConfig = config.outputModes[outputMode] || config.outputModes.website;
        let artifactContract = null;
        let executionPlan = null;
        let currentArtifact = null;
        let codeResult = null;
        let testResult = null;
        let criticResult = null;

        this.activeRuns.set(runId, {
            runId,
            input: userInput,
            outputMode,
            status: 'running',
            startedAt: new Date().toISOString(),
        });
        this.contextEngine.resetSession(runId);

        this._broadcast('pipeline:start', {
            runId,
            input: userInput,
            outputMode,
            agents: Object.keys(this.agents),
            activeRunCount: this.activeRuns.size,
        });

        try {
            const planResult = await this._executeStep(
                'planner',
                userInput,
                steps,
                logs,
                customModels.planner,
                outputMode,
                null,
                null,
                runId,
                null,
                null,
            );
            if (!planResult.success) {
                throw new Error(`Planner failed: ${planResult.error}`);
            }

            executionPlan = this._buildExecutionPlan(planResult.output, outputMode, userInput, modeConfig);
            artifactContract = resolveArtifactContract(planResult.output, outputMode, userInput);
            const assetPlan = extractPlanJson(planResult.output)?.assetPlan || null;
            if (assetPlan) {
                artifactContract.assetPlan = assetPlan;
            }

            const plannerStep = steps[steps.length - 1];
            if (plannerStep?.agent === 'planner') {
                plannerStep.executionPlan = executionPlan;
                plannerStep.artifactContract = artifactContract;
            }

            this._broadcast('pipeline:plan', {
                runId,
                outputMode,
                executionPlan,
                artifactContract,
            });

            for (const stage of executionPlan.stages) {
                if (stage.agent === 'asset' && modeConfig.skipAsset) {
                    this._recordSkippedStage(stage, outputMode, steps);
                    continue;
                }

                const stageInput = this._buildStageInput(userInput, stage, executionPlan);

                if (stage.agent === 'coder') {
                    codeResult = await this._executeStep(
                        'coder',
                        stageInput,
                        steps,
                        logs,
                        customModels.coder,
                        outputMode,
                        currentArtifact,
                        artifactContract,
                        runId,
                        executionPlan,
                        stage,
                    );

                    codeResult = await this._repairCoderIfNeeded({
                        codeResult,
                        stageInput,
                        outputMode,
                        steps,
                        logs,
                        customModels,
                        artifactContract,
                        runId,
                        executionPlan,
                        stage,
                        currentArtifact,
                    });

                    const deliverable = this._ensureCoderDeliverable(codeResult, steps, stageInput, outputMode);
                    currentArtifact = this._publishArtifactSnapshot(runId, codeResult, steps, outputMode, {
                        previousArtifact: currentArtifact,
                        sourceStep: steps[steps.length - 1]?.agent || 'coder',
                        ...deliverable,
                    });

                    const gateResult = await this._runRuleGate({
                        runId,
                        userInput: stageInput,
                        outputMode,
                        steps,
                        logs,
                        customModels,
                        artifactContract,
                        currentArtifact,
                        executionPlan,
                        stage,
                    });
                    codeResult = gateResult.codeResult;
                    currentArtifact = gateResult.currentArtifact;
                    continue;
                }

                if (stage.agent === 'tester') {
                    testResult = await this._executeStep(
                        'tester',
                        stageInput,
                        steps,
                        logs,
                        customModels.tester,
                        outputMode,
                        currentArtifact,
                        artifactContract,
                        runId,
                        executionPlan,
                        stage,
                    );
                    continue;
                }

                if (stage.agent === 'critic') {
                    criticResult = await this._executeStep(
                        'critic',
                        stageInput,
                        steps,
                        logs,
                        customModels.critic,
                        outputMode,
                        currentArtifact,
                        artifactContract,
                        runId,
                        executionPlan,
                        stage,
                    );
                    criticResult = this._normalizeCriticResult(criticResult, {
                        outputMode,
                        userInput,
                        currentArtifact,
                        testOutput: testResult?.output || '',
                    });
                    const latestStep = steps[steps.length - 1];
                    if (latestStep?.agent === 'critic') {
                        latestStep.output = criticResult.output;
                    }
                    continue;
                }

                await this._executeStep(
                    stage.agent,
                    stageInput,
                    steps,
                    logs,
                    customModels[stage.agent],
                    outputMode,
                    currentArtifact,
                    artifactContract,
                    runId,
                    executionPlan,
                    stage,
                );
            }

            if (!codeResult) {
                throw new Error('Execution plan did not produce a coder deliverable.');
            }

            if (!testResult) {
                const testerStage = this._forceStage('tester', executionPlan);
                testResult = await this._executeStep(
                    'tester',
                    this._buildStageInput(userInput, testerStage, executionPlan),
                    steps,
                    logs,
                    customModels.tester,
                    outputMode,
                    currentArtifact,
                    artifactContract,
                    runId,
                    executionPlan,
                    testerStage,
                );
            }

            if (!criticResult) {
                const criticStage = this._forceStage('critic', executionPlan);
                criticResult = await this._executeStep(
                    'critic',
                    this._buildStageInput(userInput, criticStage, executionPlan),
                    steps,
                    logs,
                    customModels.critic,
                    outputMode,
                    currentArtifact,
                    artifactContract,
                    runId,
                    executionPlan,
                    criticStage,
                );
                criticResult = this._normalizeCriticResult(criticResult, {
                    outputMode,
                    userInput,
                    currentArtifact,
                    testOutput: testResult?.output || '',
                });
                const latestStep = steps[steps.length - 1];
                if (latestStep?.agent === 'critic') {
                    latestStep.output = criticResult.output;
                }
            }

            const qualityGateResult = await this._runQualityGate({
                runId,
                userInput,
                outputMode,
                steps,
                logs,
                customModels,
                artifactContract,
                codeResult,
                testResult,
                criticResult,
                currentArtifact,
                executionPlan,
            });
            codeResult = qualityGateResult.codeResult;
            testResult = qualityGateResult.testResult;
            criticResult = qualityGateResult.criticResult;
            currentArtifact = qualityGateResult.currentArtifact;

            const previewPath = currentArtifact?.path || this._publishArtifactSnapshot(runId, codeResult, steps, outputMode).path;
            const artifacts = collectArtifacts(steps, previewPath, outputMode);
            const evaluation = this.evaluator.evaluate({
                logs,
                finalOutput: criticResult.output,
                criticOutput: criticResult.output,
                outputMode,
                steps,
            });

            const runResult = {
                runId,
                input: userInput,
                outputMode,
                steps,
                logs,
                evaluation,
                executionPlan,
                artifactContract,
                previewPath,
                artifacts,
                totalTime: Date.now() - startTime,
                status: 'completed',
                finalOutput: this.artifactPublisher.composeFinalOutput(steps),
            };

            this.contextEngine.saveRunToLongTerm(runId, {
                input: userInput,
                outputMode,
                status: 'completed',
                evaluation: evaluation.summary,
                finalOutput: runResult.finalOutput,
                previewPath,
                artifacts,
                executionPlan,
                artifactContract,
                steps,
                totalTime: runResult.totalTime,
                timestamp: new Date().toISOString(),
            });

            this.contextEngine.memory.recordRunOutcome({
                outputMode,
                steps,
                evaluation,
                providerMap: modeConfig.providerMap,
            });

            this.activeRuns.delete(runId);
            this._broadcast('pipeline:complete', {
                ...runResult,
                activeRunCount: this.activeRuns.size,
            });
            return runResult;
        } catch (error) {
            this.activeRuns.delete(runId);
            const runResult = {
                runId,
                input: userInput,
                outputMode,
                steps,
                logs,
                totalTime: Date.now() - startTime,
                status: 'error',
                error: error.message,
                activeRunCount: this.activeRuns.size,
            };
            this._broadcast('pipeline:error', runResult);
            return runResult;
        } finally {
            this.contextEngine.resetSession(runId);
        }
    }

    async _executeStep(agentName, userInput, steps, logs, preferredModel, outputMode = 'website', currentArtifact = null, artifactContract = null, runId = 'global', executionPlan = null, stage = null) {
        const agent = this.agents[agentName];
        if (!agent) {
            throw new Error(`Unknown agent: ${agentName}`);
        }

        const executionOptions = this._resolveExecutionOptions(agentName, preferredModel, outputMode);
        this._broadcast('agent:start', {
            runId,
            agent: agentName,
            role: agent.role,
            provider: executionOptions.providerName,
            model: executionOptions.model || 'default',
            outputMode,
            plannedTaskCount: stage?.tasks?.length || 0,
        });

        const context = this.contextEngine.buildContext(agentName, {
            userInput,
            previousSteps: steps,
            runId,
            outputMode,
            currentArtifact,
            artifactContract,
            executionPlan,
            currentTasks: stage?.tasks || [],
        });

        const result = await agent.execute(userInput, context, executionOptions);
        const stepData = {
            agent: agentName,
            role: agent.role,
            output: result.output,
            success: result.success,
            error: result.error || null,
            consumedArtifactHash: currentArtifact?.hash || null,
            plannedTasks: stage?.tasks || [],
            stageSummary: stage?.summary || null,
            runId,
        };

        steps.push(stepData);
        if (result.log) {
            logs.push(result.log);
        }
        if (result.log?.metrics && currentArtifact?.hash) {
            result.log.metrics.inputArtifactHash = currentArtifact.hash;
            result.log.metrics.inputArtifactId = currentArtifact.id;
        }

        this.contextEngine.storeStepResult(agentName, result, runId);

        this._broadcast('agent:complete', {
            runId,
            agent: agentName,
            role: agent.role,
            success: result.success,
            metrics: result.log?.metrics || {},
            output: result.output,
            artifactHash: currentArtifact?.hash || null,
            plannedTaskCount: stepData.plannedTasks.length,
        });

        return result;
    }

    _resolveExecutionOptions(agentName, preferredModel, outputMode = 'website') {
        const modeConfig = config.outputModes[outputMode] || config.outputModes.website;
        const normalizedAgentName = agentName === 'patch_coder' ? 'coder' : agentName;
        const providerName = modeConfig.providerMap?.[normalizedAgentName] || config.agentLLMMap[normalizedAgentName];
        return {
            providerName,
            model: preferredModel !== undefined
                ? preferredModel
                : this.llmProvider.getRecommendedModel(providerName),
        };
    }

    _buildExecutionPlan(planOutput, outputMode, userInput, modeConfig) {
        const parsed = extractPlanJson(planOutput) || {};
        const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        const tasks = rawTasks
            .filter((task) => EXECUTABLE_AGENTS.has(task?.agent))
            .map((task, index) => ({
                id: String(task.id ?? index + 1),
                name: task.name || `${task.agent}-task-${index + 1}`,
                agent: task.agent,
                description: task.description || '',
                dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map((item) => String(item)) : [],
                deliverable: task.deliverable || '',
                acceptanceChecks: Array.isArray(task.acceptanceChecks) ? task.acceptanceChecks : [],
            }));

        const intentPlan = resolveIntentPlan(planOutput, outputMode, userInput);
        const orderedTasks = this._sortTasks(tasks);
        const orderedAgents = [];

        for (const task of orderedTasks) {
            if (!orderedAgents.includes(task.agent)) {
                orderedAgents.push(task.agent);
            }
        }

        const requiredAgents = [];
        if (intentPlan.needResearch) requiredAgents.push('researcher');
        if (!modeConfig.skipAsset && (intentPlan.needAsset || orderedAgents.includes('asset'))) requiredAgents.push('asset');
        requiredAgents.push('coder', 'tester', 'critic');

        const mergedOrder = [...orderedAgents];
        for (const agent of requiredAgents) {
            if (!mergedOrder.includes(agent)) {
                mergedOrder.push(agent);
            }
        }

        const stages = mergedOrder
            .filter((agent) => EXECUTABLE_AGENTS.has(agent))
            .sort((a, b) => {
                const aTaskIndex = orderedAgents.indexOf(a);
                const bTaskIndex = orderedAgents.indexOf(b);
                if (aTaskIndex >= 0 && bTaskIndex >= 0) return aTaskIndex - bTaskIndex;
                if (aTaskIndex >= 0) return -1;
                if (bTaskIndex >= 0) return 1;
                return CANONICAL_AGENT_ORDER.indexOf(a) - CANONICAL_AGENT_ORDER.indexOf(b);
            })
            .map((agent) => {
                const stageTasks = orderedTasks.filter((task) => task.agent === agent);
                return {
                    agent,
                    tasks: stageTasks,
                    summary: stageTasks.map((task) => task.name).join(', ') || `Default ${agent} stage`,
                };
            });

        return {
            summary: parsed.summary || intentPlan.summary,
            intent: intentPlan,
            tasks: orderedTasks,
            stages,
        };
    }

    _sortTasks(tasks = []) {
        const byId = new Map(tasks.map((task) => [task.id, task]));
        const visiting = new Set();
        const visited = new Set();
        const ordered = [];

        const visit = (task) => {
            if (!task || visited.has(task.id)) return;
            if (visiting.has(task.id)) {
                ordered.push(task);
                visited.add(task.id);
                return;
            }

            visiting.add(task.id);
            for (const depId of task.dependsOn || []) {
                visit(byId.get(depId));
            }
            visiting.delete(task.id);
            if (!visited.has(task.id)) {
                visited.add(task.id);
                ordered.push(task);
            }
        };

        for (const task of tasks) {
            visit(task);
        }

        return ordered;
    }

    _buildStageInput(userInput, stage, executionPlan) {
        const taskSection = stage.tasks.length > 0
            ? stage.tasks.map((task) => {
                const checks = task.acceptanceChecks?.length
                    ? `Acceptance Checks:\n${task.acceptanceChecks.map((item) => `- ${item}`).join('\n')}`
                    : '';
                return `Task ${task.id}: ${task.name}
Description: ${task.description || 'N/A'}
Deliverable: ${task.deliverable || 'N/A'}
${checks}`.trim();
            }).join('\n\n')
            : `No explicit planner task was assigned to ${stage.agent}. Execute the default ${stage.agent} responsibility for this mode.`;

        return `${userInput}

EXECUTION STAGE
- Agent: ${stage.agent}
- Plan Summary: ${executionPlan.summary}
- Stage Summary: ${stage.summary}

PLANNED TASKS
${taskSection}`;
    }

    _forceStage(agent, executionPlan) {
        return executionPlan.stages.find((stage) => stage.agent === agent) || {
            agent,
            tasks: [],
            summary: `Forced ${agent} stage`,
        };
    }

    _recordSkippedStage(stage, outputMode, steps) {
        const step = {
            agent: stage.agent,
            role: stage.agent === 'asset' ? 'Media Asset Generation' : stage.summary,
            output: `${stage.agent} stage skipped for ${outputMode} mode.`,
            success: true,
            error: null,
            skipped: true,
            plannedTasks: stage.tasks || [],
        };
        steps.push(step);
        this._broadcast('agent:complete', {
            agent: stage.agent,
            role: step.role,
            success: true,
            metrics: { skipped: true },
            output: step.output,
            skipped: true,
            plannedTaskCount: step.plannedTasks.length,
        });
    }

    async _repairCoderIfNeeded({ codeResult, stageInput, outputMode, steps, logs, customModels, artifactContract, runId, executionPlan, stage, currentArtifact }) {
        if (this._hasRenderableCoderOutput(codeResult.output, outputMode)) {
            return codeResult;
        }

        const repairPrompt = `${stageInput}

CODER RECOVERY INSTRUCTION
- Your previous response was empty or not renderable.
- You must now return a user-facing artifact, not explanation.
- Output mode: ${outputMode}
- Return a directly previewable deliverable.
- For website mode, return exactly one self-contained html code block.`;

        return this._executeStep(
            'patch_coder',
            repairPrompt,
            steps,
            logs,
            customModels.patch_coder || customModels.coder,
            outputMode,
            currentArtifact,
            artifactContract,
            runId,
            executionPlan,
            stage,
        );
    }

    _hasRenderableCoderOutput(output, outputMode = 'website') {
        const text = String(output || '').trim();
        if (!text) return false;
        if (outputMode === 'website') {
            return /```html[\s\S]*?```/i.test(text) || /<(?:!doctype|html|body|main|section|div|form)\b/i.test(text);
        }
        if (['docx', 'sheet', 'slide', 'deep_research'].includes(outputMode)) {
            return /```html[\s\S]*?```/i.test(text) || /<(?:!doctype|html|body)\b/i.test(text);
        }
        return true;
    }

    _ensureCoderDeliverable(codeResult, steps, userInput, outputMode) {
        const originalOutput = String(codeResult.output || '');
        const safeOutput = ensureRenderableOutput(originalOutput, {
            userInput,
            previousSteps: steps,
            outputMode,
        });

        codeResult.output = safeOutput;
        const fallbackUsed = safeOutput !== originalOutput && /Guaranteed Fallback Output/i.test(safeOutput);
        const latestStep = steps[steps.length - 1];
        if (latestStep?.agent === 'coder' || latestStep?.agent === 'patch_coder') {
            latestStep.output = safeOutput;
            latestStep.success = true;
            latestStep.error = null;
            latestStep.fallbackUsed = fallbackUsed;
            latestStep.fallbackReason = fallbackUsed ? 'CODER_OUTPUT_UNUSABLE' : null;
        }

        return {
            fallbackUsed,
            fallbackReason: fallbackUsed ? 'CODER_OUTPUT_UNUSABLE' : null,
        };
    }

    async _runRuleGate({ runId, userInput, outputMode, steps, logs, customModels, artifactContract, currentArtifact, executionPlan, stage }) {
        const maxRepairAttempts = config.ruleGate?.maxRepairAttempts || 0;
        let attempt = 0;
        let codeResult = { output: currentArtifact?.content || '' };
        let violations = this._validateArtifact(outputMode, currentArtifact?.content || '', artifactContract);

        while (attempt < maxRepairAttempts && violations.length > 0) {
            attempt += 1;
            const repairMode = this._shouldEscalateRepair(violations, attempt) ? 'CONSTRAINED_REGENERATE' : 'PATCH_ONLY';
            this._broadcast('pipeline:rule-gate', {
                runId,
                attempt,
                outputMode,
                artifactHash: currentArtifact?.hash || null,
                repairMode,
                violations,
            });

            const patchPrompt = `${userInput}

RULE GATE PATCH REQUEST
- Output mode: ${outputMode}
- Repair mode: ${repairMode}
- Locked artifact hash: ${currentArtifact?.hash || 'unknown'}
- Violations to fix: ${violations.map((violation) => violation.code).join(', ')}

You must correct the rule-gate violations and keep as much of the current artifact intent as possible.
If repair mode is PATCH_ONLY, preserve the current structure and patch only the broken areas.
If repair mode is CONSTRAINED_REGENERATE, rebuild the artifact but preserve the same user request, mode contract, and core sections.
Return the corrected final artifact in the required output format.

Violation details:
${violations.map((violation) => `- ${violation.code}: ${violation.message}`).join('\n')}`;

            codeResult = await this._executeStep(
                'patch_coder',
                patchPrompt,
                steps,
                logs,
                customModels.patch_coder || customModels.coder,
                outputMode,
                currentArtifact,
                artifactContract,
                runId,
                executionPlan,
                stage,
            );

            const deliverable = this._ensureCoderDeliverable(codeResult, steps, patchPrompt, outputMode);
            const previousArtifact = currentArtifact;
            currentArtifact = this._publishArtifactSnapshot(runId, codeResult, steps, outputMode, {
                previousArtifact,
                sourceStep: 'patch_coder',
                ...deliverable,
            });
            this._recordRepairAudit(steps, previousArtifact, currentArtifact, repairMode, 'rule_gate');
            violations = this._validateArtifact(outputMode, currentArtifact.content || '', artifactContract);
        }

        this._recordRuleGateResult(steps, currentArtifact, violations);
        return { codeResult, currentArtifact, violations };
    }

    async _runQualityGate({ runId, userInput, outputMode, steps, logs, customModels, artifactContract, codeResult, testResult, criticResult, currentArtifact, executionPlan }) {
        const minScore = config.qualityGate?.minScoreByMode?.[outputMode] || config.qualityGate?.minScore || 8.5;
        const maxRepairAttempts = config.qualityGate?.maxRepairAttempts || 0;
        let quality = evaluateQuality(criticResult.output, outputMode);
        let repairAttempt = 0;
        const stage = this._forceStage('coder', executionPlan);

        while (repairAttempt < maxRepairAttempts && this._shouldRepairForQuality(quality, minScore)) {
            repairAttempt += 1;
            const latestViolations = [...steps].reverse().find((step) => step.agent === 'rule_gate')?.violations || [];
            const repairMode = this._shouldEscalateRepair(latestViolations, repairAttempt) ? 'CONSTRAINED_REGENERATE' : 'PATCH_ONLY';
            const repairInput = this._buildPatchRepairPrompt(userInput, steps, outputMode, quality, minScore, repairAttempt, currentArtifact, repairMode);

            this._broadcast('pipeline:quality-repair', {
                runId,
                attempt: repairAttempt,
                outputMode,
                score: quality.score,
                recommendation: quality.recommendation,
                minScore,
                repairMode,
            });

            codeResult = await this._executeStep(
                'patch_coder',
                repairInput,
                steps,
                logs,
                customModels.patch_coder || customModels.coder,
                outputMode,
                currentArtifact,
                artifactContract,
                runId,
                executionPlan,
                stage,
            );
            const deliverable = this._ensureCoderDeliverable(codeResult, steps, repairInput, outputMode);
            const previousArtifact = currentArtifact;
            currentArtifact = this._publishArtifactSnapshot(runId, codeResult, steps, outputMode, {
                previousArtifact,
                sourceStep: 'patch_coder',
                ...deliverable,
            });
            this._recordRepairAudit(steps, previousArtifact, currentArtifact, repairMode, 'quality_gate');

            testResult = await this._executeStep(
                'tester',
                repairInput,
                steps,
                logs,
                customModels.tester,
                outputMode,
                currentArtifact,
                artifactContract,
                runId,
                executionPlan,
                this._forceStage('tester', executionPlan),
            );
            criticResult = await this._executeStep(
                'critic',
                repairInput,
                steps,
                logs,
                customModels.critic,
                outputMode,
                currentArtifact,
                artifactContract,
                runId,
                executionPlan,
                this._forceStage('critic', executionPlan),
            );
            criticResult = this._normalizeCriticResult(criticResult, {
                outputMode,
                userInput,
                currentArtifact,
                testOutput: testResult?.output || '',
            });
            const latestStep = steps[steps.length - 1];
            if (latestStep?.agent === 'critic') {
                latestStep.output = criticResult.output;
            }
            quality = evaluateQuality(criticResult.output, outputMode);
        }

        return { codeResult, testResult, criticResult, currentArtifact };
    }

    _shouldRepairForQuality(quality, minScore) {
        return quality.score < minScore || quality.recommendation === 'REJECTED' || quality.recommendation === 'NEEDS_REVISION';
    }

    _buildPatchRepairPrompt(userInput, steps, outputMode, quality, minScore, repairAttempt, currentArtifact, repairMode = 'PATCH_ONLY') {
        const testerOutput = [...steps].reverse().find((step) => step.agent === 'tester')?.output || 'No tester feedback.';
        const criticOutput = [...steps].reverse().find((step) => step.agent === 'critic')?.output || 'No critic feedback.';

        return `${userInput}

QUALITY GATE REPAIR REQUEST
- Output mode: ${outputMode}
- Current quality score: ${quality.score}/10
- Required minimum score: ${minScore}/10
- Repair attempt: ${repairAttempt}
- Repair mode: ${repairMode}

You must improve the locked artifact below.
If repair mode is PATCH_ONLY, preserve the existing structure unless a tester/critic issue explicitly requires a change.
If repair mode is CONSTRAINED_REGENERATE, you may rebuild the artifact, but you must preserve the same user request, output mode, and core sections.
Do not replace the page with a different concept.

Locked artifact hash:
${currentArtifact?.hash || 'unknown'}

You must improve the deliverable so it can pass the quality gate.
Prioritize the issues below and return a stronger final artifact, not analysis-only text.

Latest tester feedback:
${testerOutput}

Latest critic feedback:
${criticOutput}`;
    }

    _validateArtifact(outputMode, output, artifactContract = null) {
        return validateArtifact(outputMode, output, artifactContract);
    }

    _recordRuleGateResult(steps, currentArtifact, violations) {
        const step = {
            agent: 'rule_gate',
            role: 'Static Artifact Validation',
            output: violations.length > 0
                ? `Rule gate violations detected for ${currentArtifact?.id || 'unknown artifact'}:\n${violations.map((violation) => `- ${violation.code}: ${violation.message}`).join('\n')}`
                : `Rule gate passed for ${currentArtifact?.id || 'unknown artifact'} (${currentArtifact?.hash || 'no-hash'}).`,
            success: violations.length === 0,
            error: violations.length > 0 ? 'RULE_GATE_FAILED' : null,
            consumedArtifactHash: currentArtifact?.hash || null,
            violations,
        };
        steps.push(step);
        this._broadcast('agent:complete', {
            agent: step.agent,
            role: step.role,
            success: step.success,
            metrics: {
                violations: violations.length,
                artifactHash: currentArtifact?.hash || null,
            },
            output: step.output,
            artifactHash: currentArtifact?.hash || null,
        });
    }

    _recordRepairAudit(steps, previousArtifact, currentArtifact, requestedMode, phase) {
        if (!previousArtifact?.content || !currentArtifact?.content) {
            return;
        }

        const previousLines = String(previousArtifact.content || '').split('\n');
        const nextLines = String(currentArtifact.content || '').split('\n');
        const sharedLines = previousLines.filter((line) => nextLines.includes(line)).length;
        const baseline = Math.max(previousLines.length, nextLines.length, 1);
        const preservedLineRatio = sharedLines / baseline;
        const changedLineRatio = 1 - preservedLineRatio;
        const effectiveMode = requestedMode === 'PATCH_ONLY' && changedLineRatio > 0.45
            ? 'CONSTRAINED_REGENERATE'
            : requestedMode;

        const step = {
            agent: 'repair_audit',
            role: 'Repair Delta Audit',
            success: true,
            error: null,
            consumedArtifactHash: previousArtifact.hash,
            output: `Repair audit (${phase}): requested ${requestedMode}, effective ${effectiveMode}, changed ${(changedLineRatio * 100).toFixed(1)}% of lines, preserved ${(preservedLineRatio * 100).toFixed(1)}%.`,
            metrics: {
                phase,
                requestedMode,
                effectiveMode,
                changedLineRatio,
                preservedLineRatio,
                previousArtifactHash: previousArtifact.hash,
                currentArtifactHash: currentArtifact.hash,
            },
        };
        steps.push(step);
        this._broadcast('agent:complete', {
            agent: step.agent,
            role: step.role,
            success: true,
            metrics: step.metrics,
            output: step.output,
            artifactHash: currentArtifact.hash,
        });
    }

    _shouldEscalateRepair(violations, attempt) {
        const severeCodes = new Set([
            'EMPTY_OUTPUT',
            'NON_RENDERABLE',
            'STRUCTURE_MISSING',
            'SLIDE_COUNT_TOO_LOW',
            'DATA_REGION_EMPTY',
        ]);

        const severeCount = violations.filter((violation) => severeCodes.has(violation.code)).length;
        return severeCount >= 2 || violations.length >= 4 || attempt > 1;
    }

    _normalizeCriticResult(criticResult, { outputMode = 'website', userInput = '', currentArtifact = null, testOutput = '' } = {}) {
        if (!criticResult?.output || outputMode !== 'website') {
            return criticResult;
        }

        const artifactText = String(currentArtifact?.content || '');
        const criticText = String(criticResult.output);
        const combined = `${userInput}\n${artifactText}\n${testOutput}\n${criticText}`;
        const scoreMatch = criticText.match(/(### Score:\s*)(\d+(?:\.\d+)?)(\s*\/\s*10)/i);
        if (!scoreMatch) {
            return criticResult;
        }

        const currentScore = parseFloat(scoreMatch[2]);
        const productionReadinessMatch = criticText.match(/Production Readiness\s*\|\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
        const productionReadiness = productionReadinessMatch ? parseFloat(productionReadinessMatch[1]) : null;

        let cap = 10;
        if (/NEEDS_REVISION|FAIL/i.test(testOutput)) cap = Math.min(cap, 8.4);
        if (/localstorage|settimeout|mock|demo-only|placeholder|href=["']#["']/i.test(combined)) cap = Math.min(cap, 8.4);
        if (productionReadiness !== null) cap = Math.min(cap, productionReadiness + 2);

        const normalizedScore = Math.min(currentScore, cap);
        if (normalizedScore === currentScore) {
            return criticResult;
        }

        let normalizedOutput = criticText.replace(scoreMatch[0], `${scoreMatch[1]}${normalizedScore.toFixed(1)}${scoreMatch[3]}`);
        if (/Final Recommendation[\s\S]*\*\*APPROVED\*\*/i.test(normalizedOutput) && normalizedScore < 8.5) {
            normalizedOutput = normalizedOutput.replace(/\*\*APPROVED\*\*/i, '**NEEDS_REVISION**');
        }

        if (!/Normalized Score Note/i.test(normalizedOutput)) {
            normalizedOutput += `\n\n### Normalized Score Note\nOverall score was capped to ${normalizedScore.toFixed(1)}/10 because tester evidence and production-readiness signals do not support a higher website score.`;
        }

        return {
            ...criticResult,
            output: normalizedOutput,
        };
    }

    _publishArtifactSnapshot(runId, codeResult, steps, outputMode, options = {}) {
        return this.artifactPublisher.publishArtifactSnapshot(runId, codeResult, steps, outputMode, options);
    }

    _broadcast(event, data) {
        this.broadcast(JSON.stringify({ event, data, timestamp: Date.now() }));
    }

    async getStatus() {
        await this.llmProvider.ensureReady();
        return {
            isRunning: this.activeRuns.size > 0,
            activeRunCount: this.activeRuns.size,
            activeRuns: [...this.activeRuns.values()],
            availableProviders: this.llmProvider.getAvailableProviders(),
            providerCatalogs: this.llmProvider.getProviderCatalogs(),
            agentConfig: config.agentLLMMap,
            agentModels: config.agentModelMap,
            outputModes: Object.keys(config.outputModes),
            modeProfiles: config.outputModes,
        };
    }

    getHistory() {
        return this.contextEngine.getHistory();
    }

    getEvaluations() {
        return this.evaluator.getHistory();
    }
}
