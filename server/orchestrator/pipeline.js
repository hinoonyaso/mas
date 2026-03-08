import { v4 as uuidv4 } from 'uuid';
import config from '../config.js';
import { DemoLLMProvider } from '../llm/provider.js';
import ContextEngine from '../context/engine.js';
import Evaluator from '../harness/evaluator.js';
import PlannerAgent from '../agents/planner.js';
import SpecBuilderAgent from '../agents/spec-builder.js';
import ResearcherAgent from '../agents/researcher.js';
import AssetAgent from '../agents/asset.js';
import CoderAgent from '../agents/coder.js';
import PatchCoderAgent from '../agents/patch-coder.js';
import TesterAgent from '../agents/tester.js';
import CriticAgent from '../agents/critic.js';
import { savePreviewArtifact } from '../artifacts/preview.js';
import { collectArtifacts } from '../artifacts/manifest.js';
import { resolveIntentPlan, buildSpecBuilderInput } from './intentRouter.js';
import { resolveArtifactContract } from './artifactContract.js';
import { createArtifactPublisher } from './artifactPublisher.js';
import { createRepairStrategy } from './repairStrategy.js';

export default class Pipeline {
    constructor(broadcast) {
        this.broadcast = broadcast || (() => { });
        this.llmProvider = new DemoLLMProvider();
        this.contextEngine = new ContextEngine();
        this.evaluator = new Evaluator();
        this.isRunning = false;

        const map = config.agentLLMMap;
        this.agents = {
            planner: new PlannerAgent(this.llmProvider, map.planner),
            spec_builder: new SpecBuilderAgent(this.llmProvider, map.spec_builder),
            researcher: new ResearcherAgent(this.llmProvider, map.researcher),
            asset: new AssetAgent(this.llmProvider, map.asset),
            coder: new CoderAgent(this.llmProvider, map.coder),
            patch_coder: new PatchCoderAgent(this.llmProvider, map.patch_coder),
            tester: new TesterAgent(this.llmProvider, map.tester),
            critic: new CriticAgent(this.llmProvider, map.critic),
        };

        const _broadcast = (event, data) => this._broadcast(event, data);
        const _executeStep = (...args) => this._executeStep(...args);

        this.publisher = createArtifactPublisher(_broadcast);
        this.repair = createRepairStrategy({
            executeStep: _executeStep,
            publishArtifactSnapshot: (...args) => this.publisher.publishArtifactSnapshot(...args),
            broadcast: _broadcast,
        });
    }

    async run(userInput, customModels = {}, outputMode = 'website') {
        if (this.isRunning) {
            throw new Error('Pipeline is already running');
        }

        this.isRunning = true;
        const runId = uuidv4();
        const startTime = Date.now();
        const steps = [];
        const logs = [];
        let artifactContract = null;

        const modeConfig = config.outputModes[outputMode] || config.outputModes.website;
        this.contextEngine.resetSession();

        this._broadcast('pipeline:start', {
            runId,
            input: userInput,
            outputMode,
            agents: ['planner', 'spec_builder', 'researcher', 'asset', 'coder', 'tester', 'critic'],
        });

        try {
            // Step 1: Intent Planner
            const intentResult = await this._executeStep('planner', userInput, steps, logs, customModels.planner, outputMode);
            if (!intentResult.success) throw new Error('Planner failed: ' + intentResult.error);
            const intentPlan = resolveIntentPlan(intentResult.output, outputMode, userInput);

            // Step 2: Spec Builder
            const specInput = buildSpecBuilderInput(userInput, intentPlan, outputMode);
            const specResult = await this._executeStep('spec_builder', specInput, steps, logs, customModels.spec_builder, outputMode);
            if (!specResult.success) throw new Error('Spec builder failed: ' + specResult.error);
            artifactContract = resolveArtifactContract(specResult.output, outputMode, userInput);

            // Step 3: Researcher (intent 기반 선택)
            if (intentPlan.needResearch !== false) {
                await this._executeStep('researcher', userInput, steps, logs, customModels.researcher, outputMode);
            } else {
                this._recordSkippedStep(steps, 'researcher', this.agents.researcher.role, 'Research skipped by planner intent.');
            }

            // Step 4: Asset (모드 + intent 기반 선택)
            if (!modeConfig.skipAsset && intentPlan.needAsset) {
                await this._executeStep('asset', userInput, steps, logs, customModels.asset, outputMode);
            } else {
                const reason = modeConfig.skipAsset
                    ? `Asset generation skipped for ${outputMode} output mode.`
                    : 'Asset generation skipped by planner intent.';
                this._recordSkippedStep(steps, 'asset', this.agents.asset.role, reason);
            }

            // Step 5: Coder
            let codeResult = await this._executeStep('coder', userInput, steps, logs, customModels.coder, outputMode, null, artifactContract);
            codeResult = await this.repair.repairCoderIfNeeded(codeResult, userInput, outputMode, steps, logs, customModels, artifactContract);
            this.repair.ensureCoderDeliverable(codeResult, steps, userInput, outputMode);
            let currentArtifact = this.publisher.publishArtifactSnapshot(runId, codeResult, steps, outputMode);

            const gateResult = await this.repair.runRuleGate({ runId, userInput, outputMode, steps, logs, customModels, artifactContract, currentArtifact });
            codeResult = gateResult.codeResult;
            currentArtifact = gateResult.currentArtifact;

            // Step 6: Tester
            let testResult = await this._executeStep('tester', userInput, steps, logs, customModels.tester, outputMode, currentArtifact, artifactContract);

            // Step 7: Critic
            let criticResult = await this._executeStep('critic', userInput, steps, logs, customModels.critic, outputMode, currentArtifact, artifactContract);

            const qualityGateResult = await this.repair.runQualityGate({ runId, userInput, outputMode, steps, logs, customModels, artifactContract, codeResult, testResult, criticResult, currentArtifact });
            codeResult = qualityGateResult.codeResult;
            testResult = qualityGateResult.testResult;
            criticResult = qualityGateResult.criticResult;
            currentArtifact = qualityGateResult.currentArtifact;

            const previewPath = currentArtifact?.path || savePreviewArtifact(runId, codeResult.output, outputMode);
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
                previewPath,
                artifacts,
                totalTime: Date.now() - startTime,
                status: 'completed',
                finalOutput: this.publisher.composeFinalOutput(steps),
            };

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

    async _executeStep(agentName, userInput, steps, logs, preferredModel, outputMode = 'website', currentArtifact = null, artifactContract = null) {
        const agent = this.agents[agentName];
        const executionOptions = this._resolveExecutionOptions(agentName, preferredModel, outputMode);

        this._broadcast('agent:start', {
            agent: agentName,
            role: agent.role,
            provider: executionOptions.providerName,
            model: executionOptions.model || 'default',
            outputMode,
        });

        const context = this.contextEngine.buildContext(agentName, {
            userInput,
            previousSteps: steps,
            outputMode,
            currentArtifact,
            artifactContract,
        });

        const result = await agent.execute(userInput, context, executionOptions);

        const stepData = {
            agent: agentName,
            role: agent.role,
            output: result.output,
            success: result.success,
            error: result.error || null,
            consumedArtifactHash: currentArtifact?.hash || null,
        };

        steps.push(stepData);
        if (result.log) logs.push(result.log);
        if (result.log?.metrics && currentArtifact?.hash) {
            result.log.metrics.inputArtifactHash = currentArtifact.hash;
            result.log.metrics.inputArtifactId = currentArtifact.id;
        }

        this.contextEngine.storeStepResult(agentName, result);

        this._broadcast('agent:complete', {
            agent: agentName,
            role: agent.role,
            success: result.success,
            metrics: result.log?.metrics || {},
            output: result.output,
            artifactHash: currentArtifact?.hash || null,
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

    _recordSkippedStep(steps, agentName, role, output) {
        const skipStep = {
            agent: agentName,
            role,
            output,
            success: true,
            error: null,
        };
        steps.push(skipStep);
        this._broadcast('agent:complete', {
            agent: agentName,
            role,
            success: true,
            metrics: {},
            output,
            skipped: true,
        });
        return skipStep;
    }

    _broadcast(event, data) {
        this.broadcast(JSON.stringify({ event, data, timestamp: Date.now() }));
    }

    async getStatus() {
        await this.llmProvider.providerDetectionPromise;
        const availableProviders = this.llmProvider.getAvailableProviders();
        return {
            isRunning: this.isRunning,
            availableProviders,
            providerHealth: {
                mode: availableProviders.length > 0 ? 'live' : 'demo',
                availableProviders,
                missingProviders: ['gemini', 'claude', 'codex'].filter((p) => !availableProviders.includes(p)),
            },
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
