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
import { savePreviewArtifact } from '../artifacts/preview.js';
import { collectArtifacts } from '../artifacts/manifest.js';

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
    async run(userInput, customModels = {}) {
        if (this.isRunning) {
            throw new Error('Pipeline is already running');
        }

        this.isRunning = true;
        const runId = uuidv4();
        const startTime = Date.now();
        const steps = [];
        const logs = [];

        this.contextEngine.resetSession();

        this._broadcast('pipeline:start', {
            runId,
            input: userInput,
            agents: Object.keys(this.agents),
        });

        try {
            // Step 1: Planner
            const planResult = await this._executeStep('planner', userInput, steps, logs, customModels.planner);
            if (!planResult.success) throw new Error('Planner failed: ' + planResult.error);

            // Step 2: Researcher
            const researchResult = await this._executeStep('researcher', userInput, steps, logs, customModels.researcher);

            // Step 3: Asset
            const assetResult = await this._executeStep('asset', userInput, steps, logs, customModels.asset);

            // Step 4: Coder
            const codeResult = await this._executeStep('coder', userInput, steps, logs, customModels.coder);

            // Step 5: Tester
            const testResult = await this._executeStep('tester', userInput, steps, logs, customModels.tester);

            // Step 6: Critic
            const criticResult = await this._executeStep('critic', userInput, steps, logs, customModels.critic);

            const previewPath = savePreviewArtifact(runId, codeResult.output);
            const artifacts = collectArtifacts(steps, previewPath);

            // 평가
            const evaluation = this.evaluator.evaluate({
                logs,
                finalOutput: criticResult.output,
                criticOutput: criticResult.output,
            });

            const runResult = {
                runId,
                input: userInput,
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

    async _executeStep(agentName, userInput, steps, logs, preferredModel) {
        const agent = this.agents[agentName];

        // Use user-selected model or fallback to config default
        const modelToUse = preferredModel || config.agentModelMap[agentName];

        this._broadcast('agent:start', {
            agent: agentName,
            role: agent.role,
            provider: agent.providerName,
        });

        // 컨텍스트 구성
        const context = this.contextEngine.buildContext(agentName, {
            userInput,
            previousSteps: steps,
        });

        // 실행
        const result = await agent.execute(userInput, context, modelToUse);

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
            models: config.models,
        };
    }

    getHistory() {
        return this.contextEngine.getHistory();
    }

    getEvaluations() {
        return this.evaluator.getHistory();
    }
}
