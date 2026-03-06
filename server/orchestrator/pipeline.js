import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
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
        let artifactContract = null;

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
            artifactContract = this._resolveArtifactContract(planResult.output, outputMode, userInput);

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
            let codeResult = await this._executeStep('coder', userInput, steps, logs, customModels.coder, outputMode, null, artifactContract);
            codeResult = await this._repairCoderIfNeeded(codeResult, userInput, outputMode, steps, logs, customModels, artifactContract);
            this._ensureCoderDeliverable(codeResult, steps, userInput, outputMode);
            let currentArtifact = this._publishArtifactSnapshot(runId, codeResult, steps, outputMode);
            const gateResult = await this._runRuleGate({
                runId,
                userInput,
                outputMode,
                steps,
                logs,
                customModels,
                artifactContract,
                currentArtifact,
            });
            codeResult = gateResult.codeResult;
            currentArtifact = gateResult.currentArtifact;

            // Step 5: Tester
            let testResult = await this._executeStep('tester', userInput, steps, logs, customModels.tester, outputMode, currentArtifact, artifactContract);

            // Step 6: Critic
            let criticResult = await this._executeStep('critic', userInput, steps, logs, customModels.critic, outputMode, currentArtifact, artifactContract);

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
            });
            codeResult = qualityGateResult.codeResult;
            testResult = qualityGateResult.testResult;
            criticResult = qualityGateResult.criticResult;
            currentArtifact = qualityGateResult.currentArtifact;

            const previewPath = currentArtifact?.path || savePreviewArtifact(runId, codeResult.output, outputMode);
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

        // 컨텍스트 구성 (outputMode 포함)
        const context = this.contextEngine.buildContext(agentName, {
            userInput,
            previousSteps: steps,
            outputMode,
            currentArtifact,
            artifactContract,
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
            consumedArtifactHash: currentArtifact?.hash || null,
        };

        steps.push(stepData);
        if (result.log) logs.push(result.log);
        if (result.log?.metrics && currentArtifact?.hash) {
            result.log.metrics.inputArtifactHash = currentArtifact.hash;
            result.log.metrics.inputArtifactId = currentArtifact.id;
        }

        // 컨텍스트 엔진에 결과 저장
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

    async _repairCoderIfNeeded(codeResult, userInput, outputMode, steps, logs, customModels, artifactContract) {
        if (this._hasRenderableCoderOutput(codeResult.output, outputMode)) {
            return codeResult;
        }

        const repairPrompt = `${userInput}

CODER RECOVERY INSTRUCTION
- Your previous response was empty or not renderable.
- You must now return a user-facing artifact, not explanation.
- Output mode: ${outputMode}
- Return a directly previewable deliverable.
- For website mode, return exactly one self-contained html code block.`;

        const retried = await this._executeStep('coder', repairPrompt, steps, logs, customModels.coder, outputMode, null, artifactContract);
        return this._hasRenderableCoderOutput(retried.output, outputMode) ? retried : retried;
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

    async _runQualityGate({ runId, userInput, outputMode, steps, logs, customModels, artifactContract, codeResult, testResult, criticResult, currentArtifact }) {
        const minScore = config.qualityGate?.minScore || 8.5;
        const maxRepairAttempts = config.qualityGate?.maxRepairAttempts || 0;
        let quality = evaluateQuality(criticResult.output, outputMode);
        let repairAttempt = 0;

        while (repairAttempt < maxRepairAttempts && this._shouldRepairForQuality(quality, minScore)) {
            repairAttempt += 1;
            const repairInput = this._buildPatchRepairPrompt(userInput, steps, outputMode, quality, minScore, repairAttempt, currentArtifact);

            this._broadcast('pipeline:quality-repair', {
                attempt: repairAttempt,
                outputMode,
                score: quality.score,
                recommendation: quality.recommendation,
                minScore,
            });

            codeResult = await this._executeStep('coder', repairInput, steps, logs, customModels.coder, outputMode, currentArtifact, artifactContract);
            this._ensureCoderDeliverable(codeResult, steps, repairInput, outputMode);
            currentArtifact = this._publishArtifactSnapshot(runId, codeResult, steps, outputMode);
            testResult = await this._executeStep('tester', repairInput, steps, logs, customModels.tester, outputMode, currentArtifact, artifactContract);
            criticResult = await this._executeStep('critic', repairInput, steps, logs, customModels.critic, outputMode, currentArtifact, artifactContract);
            quality = evaluateQuality(criticResult.output, outputMode);
        }

        return { codeResult, testResult, criticResult, currentArtifact };
    }

    _shouldRepairForQuality(quality, minScore) {
        return quality.score < minScore || quality.recommendation === 'REJECTED' || quality.recommendation === 'NEEDS_REVISION';
    }

    _buildPatchRepairPrompt(userInput, steps, outputMode, quality, minScore, repairAttempt, currentArtifact) {
        const testerOutput = [...steps].reverse().find((step) => step.agent === 'tester')?.output || 'No tester feedback.';
        const criticOutput = [...steps].reverse().find((step) => step.agent === 'critic')?.output || 'No critic feedback.';

        return `${userInput}

QUALITY GATE REPAIR REQUEST
- Output mode: ${outputMode}
- Current quality score: ${quality.score}/10
- Required minimum score: ${minScore}/10
- Repair attempt: ${repairAttempt}
- Repair mode: PATCH ONLY

You must patch the locked artifact below instead of fully redesigning it.
Preserve the existing structure unless a tester/critic issue explicitly requires a change.
Do not replace the whole page with a new concept.

Locked artifact hash:
${currentArtifact?.hash || 'unknown'}

You must improve the deliverable so it can pass the quality gate.
Prioritize the issues below and return a stronger final artifact, not analysis-only text.

Latest tester feedback:
${testerOutput}

Latest critic feedback:
${criticOutput}`;
    }

    async _runRuleGate({ runId, userInput, outputMode, steps, logs, customModels, artifactContract, currentArtifact }) {
        const maxRepairAttempts = config.ruleGate?.maxRepairAttempts || 0;
        let attempt = 0;
        let codeResult = { output: currentArtifact?.content || '' };
        let violations = this._validateArtifact(outputMode, currentArtifact?.content || '', artifactContract);

        while (attempt < maxRepairAttempts && violations.length > 0) {
            attempt += 1;
            this._broadcast('pipeline:rule-gate', {
                attempt,
                outputMode,
                artifactHash: currentArtifact?.hash || null,
                violations,
            });

            const patchPrompt = `${userInput}

RULE GATE PATCH REQUEST
- Output mode: ${outputMode}
- Repair mode: PATCH ONLY
- Locked artifact hash: ${currentArtifact?.hash || 'unknown'}
- Violations to fix: ${violations.map((v) => v.code).join(', ')}

You must fix only these rule-gate violations while preserving the current artifact's structure and intent.
Return the corrected final artifact in the required output format.

Violation details:
${violations.map((v) => `- ${v.code}: ${v.message}`).join('\n')}`;

            codeResult = await this._executeStep('coder', patchPrompt, steps, logs, customModels.coder, outputMode, currentArtifact, artifactContract);
            this._ensureCoderDeliverable(codeResult, steps, patchPrompt, outputMode);
            currentArtifact = this._publishArtifactSnapshot(runId, codeResult, steps, outputMode);
            violations = this._validateArtifact(outputMode, currentArtifact.content || '', artifactContract);
        }

        this._recordRuleGateResult(steps, currentArtifact, violations);
        return { codeResult, currentArtifact, violations };
    }

    _recordRuleGateResult(steps, currentArtifact, violations) {
        steps.push({
            agent: 'rule_gate',
            role: 'Static Artifact Validation',
            output: violations.length > 0
                ? `Rule gate violations detected for ${currentArtifact?.id || 'unknown artifact'}:\n${violations.map((v) => `- ${v.code}: ${v.message}`).join('\n')}`
                : `Rule gate passed for ${currentArtifact?.id || 'unknown artifact'} (${currentArtifact?.hash || 'no-hash'}).`,
            success: violations.length === 0,
            error: violations.length > 0 ? 'RULE_GATE_FAILED' : null,
            consumedArtifactHash: currentArtifact?.hash || null,
            violations,
        });
    }

    _validateArtifact(outputMode, output, artifactContract = null) {
        const text = String(output || '');
        const violations = [];
        const requiredElements = artifactContract?.requiredElements || [];
        const forbiddenPatterns = artifactContract?.forbiddenPatterns || [];
        const renderRequirements = artifactContract?.renderRequirements || [];

        if (!text.trim()) {
            violations.push({ code: 'EMPTY_OUTPUT', message: 'Artifact output is empty.' });
            return violations;
        }

        if (outputMode === 'website') {
            if (!/(?:<!doctype html>|<html\b)/i.test(text)) {
                violations.push({ code: 'NON_RENDERABLE', message: 'Website artifact must contain a full HTML document root.' });
            }
            if (!/<style\b/i.test(text)) {
                violations.push({ code: 'MISSING_STYLE_TAG', message: 'Website artifact must inline CSS in a <style> tag.' });
            }
            if (!/<script\b/i.test(text)) {
                violations.push({ code: 'MISSING_SCRIPT_TAG', message: 'Website artifact must inline JS in a <script> tag when interactive behavior is needed.' });
            }
            if (/<link\b[^>]*rel=["']stylesheet["']/i.test(text)) {
                violations.push({ code: 'EXTERNAL_REF_VIOLATION', message: 'External stylesheet links are forbidden for website preview artifacts.' });
            }
            if (/<script\b[^>]*src=/i.test(text)) {
                violations.push({ code: 'EXTERNAL_SCRIPT_VIOLATION', message: 'External script src references are forbidden for website preview artifacts.' });
            }
            if (/(로그인|login|signin|auth|인증)/i.test(text + ' ' + JSON.stringify(requiredElements)) && !/<form\b/i.test(text)) {
                violations.push({ code: 'STRUCTURE_MISSING', message: 'Login/auth pages must contain a form element.' });
            }
        }

        for (const requirement of requiredElements) {
            if (!text.toLowerCase().includes(String(requirement).toLowerCase())) {
                violations.push({ code: 'REQUIRED_ELEMENT_MISSING', message: `Required element missing from artifact: ${requirement}` });
            }
        }

        for (const forbidden of forbiddenPatterns) {
            if (/external css link/i.test(forbidden) && /<link\b[^>]*rel=["']stylesheet["']/i.test(text)) {
                violations.push({ code: 'FORBIDDEN_PATTERN', message: 'Forbidden pattern detected: external css link.' });
            }
            if (/external script src/i.test(forbidden) && /<script\b[^>]*src=/i.test(text)) {
                violations.push({ code: 'FORBIDDEN_PATTERN', message: 'Forbidden pattern detected: external script src.' });
            }
        }

        if (renderRequirements.some((r) => /body must not be empty/i.test(String(r))) && /<body[^>]*>\s*<\/body>/i.test(text)) {
            violations.push({ code: 'EMPTY_BODY', message: 'Render requirement violated: body must not be empty.' });
        }

        return this._dedupeViolations(violations);
    }

    _dedupeViolations(violations) {
        const seen = new Set();
        return violations.filter((violation) => {
            const key = `${violation.code}:${violation.message}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    _resolveArtifactContract(planOutput, outputMode, userInput) {
        const defaults = this._getDefaultArtifactContract(outputMode, userInput);
        const parsed = this._extractPlanJson(planOutput);
        const contract = parsed?.finalArtifactContract || {};
        return {
            ...defaults,
            ...contract,
            requiredElements: contract.requiredElements || defaults.requiredElements,
            forbiddenPatterns: contract.forbiddenPatterns || defaults.forbiddenPatterns,
            renderRequirements: contract.renderRequirements || defaults.renderRequirements,
        };
    }

    _extractPlanJson(planOutput) {
        const text = String(planOutput || '');
        const fenced = text.match(/```json\s*([\s\S]*?)```/i);
        const candidate = fenced ? fenced[1] : text.match(/\{[\s\S]*\}/)?.[0];
        if (!candidate) return null;
        try {
            return JSON.parse(candidate);
        } catch {
            return null;
        }
    }

    _getDefaultArtifactContract(outputMode, userInput) {
        if (outputMode === 'website') {
            const isLogin = /login|signin|signup|auth|로그인|인증|회원가입/i.test(String(userInput || ''));
            return {
                type: 'single self-contained HTML document',
                requiredElements: isLogin ? ['<form', 'button', 'input'] : ['<main', '<style'],
                forbiddenPatterns: ['external css link', 'external script src'],
                renderRequirements: ['renderable in a single iframe', 'body must not be empty'],
                assetPolicy: 'reuse existing asset first, generated asset second, deterministic fallback last',
                reusePolicy: 'reuse existing implementation when present',
                repairStrategy: 'patch existing artifact before full regeneration',
            };
        }

        return {
            type: 'self-contained artifact',
            requiredElements: [],
            forbiddenPatterns: [],
            renderRequirements: [],
            assetPolicy: 'mode default',
            reusePolicy: 'reuse existing implementation when present',
            repairStrategy: 'patch existing artifact before full regeneration',
        };
    }

    _publishArtifactSnapshot(runId, codeResult, steps, outputMode) {
        const previewPath = savePreviewArtifact(runId, codeResult.output, outputMode);
        const hash = crypto.createHash('sha256').update(String(codeResult.output || '')).digest('hex');
        const artifact = {
            id: `artifact-${hash.slice(0, 12)}`,
            hash,
            path: previewPath,
            type: outputMode,
            producedBy: 'coder',
            content: String(codeResult.output || '').slice(0, 12000),
        };

        const latestStep = steps[steps.length - 1];
        if (latestStep?.agent === 'coder') {
            latestStep.artifact = artifact;
        }

        this._broadcast('artifact:published', artifact);
        return artifact;
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
