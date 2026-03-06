import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import { DemoLLMProvider } from '../llm/provider.js';
import ContextEngine from '../context/engine.js';
import Evaluator from '../harness/evaluator.js';
import PlannerAgent from '../agents/planner.js';
import ResearcherAgent from '../agents/researcher.js';
import AssetAgent from '../agents/asset.js';
import CoderAgent from '../agents/coder.js';
import TesterAgent from '../agents/tester.js';
import CriticAgent from '../agents/critic.js';
import { ensureRenderableOutput, savePreviewArtifact } from '../artifacts/preview.js';
import { collectArtifacts } from '../artifacts/manifest.js';
import { evaluateQuality } from '../harness/metrics.js';

export default class Pipeline {
    constructor(broadcast) {
        this.broadcast = broadcast || (() => { });
        this.llmProvider = new DemoLLMProvider();
        this.contextEngine = new ContextEngine();
        this.evaluator = new Evaluator();
        this.isRunning = false;

        // 에이전트 초기화
        const map = config.agentLLMMap;
        this.agents = {
            planner: new PlannerAgent(this.llmProvider, map.planner),
            researcher: new ResearcherAgent(this.llmProvider, map.researcher),
            asset: new AssetAgent(this.llmProvider, map.asset),
            coder: new CoderAgent(this.llmProvider, map.coder),
            tester: new TesterAgent(this.llmProvider, map.tester),
            critic: new CriticAgent(this.llmProvider, map.critic),
        };
    }

    /**
     * 전체 파이프라인 실행
     */
    async run(userInput, customModels = {}, outputMode = 'website') {
        if (this.isRunning) {
            throw new Error('Pipeline is already running');
        }

        this.isRunning = true;
        const runId = uuidv4();
        const startTime = Date.now();
        const steps = [];
        const logs = [];

        // 출력 모드 설정 로드
        const modeConfig = config.outputModes[outputMode] || config.outputModes.website;

        this.contextEngine.resetSession();

        this._broadcast('pipeline:start', {
            runId,
            input: userInput,
            outputMode,
            agents: Object.keys(this.agents),
        });

        try {
            // Step 1: Planner
            const planResult = await this._executeStep('planner', userInput, steps, logs, customModels.planner, outputMode);
            if (!planResult.success) throw new Error('Planner failed: ' + planResult.error);

            // Step 2: Researcher
            const researchResult = await this._executeStep('researcher', userInput, steps, logs, customModels.researcher, outputMode);

            // Step 3: Asset (모드에 따라 스킵 가능)
            let assetResult = null;
            if (!modeConfig.skipAsset) {
                assetResult = await this._executeStep('asset', userInput, steps, logs, customModels.asset, outputMode);
            } else {
                // Asset 스킵 시 로그만 추가
                const skipStep = {
                    agent: 'asset',
                    role: 'Media Asset Generation',
                    output: `Asset generation skipped for ${outputMode} output mode.`,
                    success: true,
                    error: null,
                };
                steps.push(skipStep);
                this._broadcast('agent:complete', {
                    agent: 'asset',
                    role: 'Media Asset Generation',
                    success: true,
                    metrics: {},
                    output: skipStep.output,
                    skipped: true,
                });
            }

            // Step 4: Coder
            let codeResult = await this._executeStep('coder', userInput, steps, logs, customModels.coder, outputMode);
            this._ensureCoderDeliverable(codeResult, steps, userInput, outputMode);

            // Step 5: Tester
            let testResult = await this._executeStep('tester', userInput, steps, logs, customModels.tester, outputMode);

            // Step 6: Critic
            let criticResult = await this._executeStep('critic', userInput, steps, logs, customModels.critic, outputMode);

            const gateResult = await this._runQualityGate({
                userInput,
                outputMode,
                steps,
                logs,
                customModels,
                codeResult,
                testResult,
                criticResult,
            });
            codeResult = gateResult.codeResult;
            testResult = gateResult.testResult;
            criticResult = gateResult.criticResult;

            const previewPath = savePreviewArtifact(runId, codeResult.output, outputMode);
            const artifacts = collectArtifacts(steps, previewPath, outputMode);

            // 평가
            const evaluation = this.evaluator.evaluate({
                logs,
                finalOutput: criticResult.output,
                criticOutput: criticResult.output,
                outputMode,
            });

            const runResult = {
                runId,
                input: userInput,
                outputMode,
                steps,
                logs,
                evaluation,
                previewPath,
                artifacts,
                totalTime: Date.now() - startTime,
                status: 'completed',
                finalOutput: this._composeFinalOutput(steps),
            };

            // 장기 메모리에 저장
            this.contextEngine.saveRunToLongTerm(runId, {
                input: userInput,
                outputMode,
                status: 'completed',
                evaluation: evaluation.summary,
                finalOutput: runResult.finalOutput,
                previewPath,
                artifacts,
                steps,
                totalTime: runResult.totalTime,
                timestamp: new Date().toISOString(),
            });

            this._broadcast('pipeline:complete', runResult);
            this.isRunning = false;
            return runResult;

        } catch (error) {
            const runResult = {
                runId,
                input: userInput,
                outputMode,
                steps,
                logs,
                totalTime: Date.now() - startTime,
                status: 'error',
                error: error.message,
            };

            this._broadcast('pipeline:error', runResult);
            this.isRunning = false;
            return runResult;
        }
    }

    async _executeStep(agentName, userInput, steps, logs, preferredModel, outputMode = 'website') {
        const agent = this.agents[agentName];
        const executionOptions = this._resolveExecutionOptions(agentName, preferredModel, outputMode);

        this._broadcast('agent:start', {
            agent: agentName,
            role: agent.role,
            provider: executionOptions.providerName,
            model: executionOptions.model || 'default',
            outputMode,
        });

        // 컨텍스트 구성 (outputMode 포함)
        const context = this.contextEngine.buildContext(agentName, {
            userInput,
            previousSteps: steps,
            outputMode,
        });

        // 실행
        const result = await agent.execute(userInput, context, executionOptions);

        // 결과 저장
        const stepData = {
            agent: agentName,
            role: agent.role,
            output: result.output,
            success: result.success,
            error: result.error || null,
        };

        steps.push(stepData);
        if (result.log) logs.push(result.log);

        // 컨텍스트 엔진에 결과 저장
        this.contextEngine.storeStepResult(agentName, result);

        this._broadcast('agent:complete', {
            agent: agentName,
            role: agent.role,
            success: result.success,
            metrics: result.log?.metrics || {},
            output: result.output,
        });

        return result;
    }

    _resolveExecutionOptions(agentName, preferredModel, outputMode = 'website') {
        const modeConfig = config.outputModes[outputMode] || config.outputModes.website;
        return {
            providerName: modeConfig.providerMap?.[agentName] || config.agentLLMMap[agentName],
            model: preferredModel || modeConfig.modelMap?.[agentName] || config.agentModelMap[agentName] || '',
        };
    }

    _ensureCoderDeliverable(codeResult, steps, userInput, outputMode) {
        const safeOutput = ensureRenderableOutput(codeResult.output, {
            userInput,
            previousSteps: steps,
            outputMode,
        });

        codeResult.output = safeOutput;
        const latestStep = steps[steps.length - 1];
        if (latestStep?.agent === 'coder') {
            latestStep.output = safeOutput;
            latestStep.success = true;
            latestStep.error = null;
        }
    }

    async _runQualityGate({ userInput, outputMode, steps, logs, customModels, codeResult, testResult, criticResult }) {
        const minScore = config.qualityGate?.minScore || 8.5;
        const maxRepairAttempts = config.qualityGate?.maxRepairAttempts || 0;
        let quality = evaluateQuality(criticResult.output, outputMode);
        let repairAttempt = 0;

        while (repairAttempt < maxRepairAttempts && this._shouldRepairForQuality(quality, minScore)) {
            repairAttempt += 1;
            const repairInput = this._buildRepairPrompt(userInput, steps, outputMode, quality, minScore, repairAttempt);

            this._broadcast('pipeline:quality-repair', {
                attempt: repairAttempt,
                outputMode,
                score: quality.score,
                recommendation: quality.recommendation,
                minScore,
            });

            codeResult = await this._executeStep('coder', repairInput, steps, logs, customModels.coder, outputMode);
            this._ensureCoderDeliverable(codeResult, steps, repairInput, outputMode);
            testResult = await this._executeStep('tester', repairInput, steps, logs, customModels.tester, outputMode);
            criticResult = await this._executeStep('critic', repairInput, steps, logs, customModels.critic, outputMode);
            quality = evaluateQuality(criticResult.output, outputMode);
        }

        return { codeResult, testResult, criticResult };
    }

    _shouldRepairForQuality(quality, minScore) {
        return quality.score < minScore || quality.recommendation === 'REJECTED' || quality.recommendation === 'NEEDS_REVISION';
    }

    _buildRepairPrompt(userInput, steps, outputMode, quality, minScore, repairAttempt) {
        const testerOutput = [...steps].reverse().find((step) => step.agent === 'tester')?.output || 'No tester feedback.';
        const criticOutput = [...steps].reverse().find((step) => step.agent === 'critic')?.output || 'No critic feedback.';

        return `${userInput}

QUALITY GATE REPAIR REQUEST
- Output mode: ${outputMode}
- Current quality score: ${quality.score}/10
- Required minimum score: ${minScore}/10
- Repair attempt: ${repairAttempt}

You must improve the deliverable so it can pass the quality gate.
Prioritize the issues below and return a stronger final artifact, not analysis-only text.

Latest tester feedback:
${testerOutput}

Latest critic feedback:
${criticOutput}`;
    }

    _composeFinalOutput(steps) {
        return steps
            .filter((s) => s.success && s.output)
            .map((s) => `## ${s.agent.charAt(0).toUpperCase() + s.agent.slice(1)} Agent (${s.role})\n\n${s.output}`)
            .join('\n\n---\n\n');
    }

    _broadcast(event, data) {
        this.broadcast(JSON.stringify({ event, data, timestamp: Date.now() }));
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            availableProviders: this.llmProvider.getAvailableProviders(),
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
