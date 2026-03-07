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
        let assetPlan = null;

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
            assetPlan = this._extractAssetPlan(planResult.output);
            if (assetPlan && artifactContract) {
                artifactContract.assetPlan = assetPlan;
            }

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

            // 적응형 정책 업데이트
            this.contextEngine.memory.recordRunOutcome({
                outputMode,
                steps,
                evaluation,
                providerMap: modeConfig.providerMap,
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
        const providerName = modeConfig.providerMap?.[agentName] || config.agentLLMMap[agentName];
        return {
            providerName,
            model: preferredModel !== undefined
                ? preferredModel
                : this.llmProvider.getRecommendedModel(providerName),
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
        const minScore = config.qualityGate?.minScoreByMode?.[outputMode] || config.qualityGate?.minScore || 8.5;
        const maxRepairAttempts = config.qualityGate?.maxRepairAttempts || 0;
        criticResult = this._normalizeCriticResult(criticResult, {
            outputMode,
            userInput,
            currentArtifact,
            testOutput: testResult?.output || '',
        });
        let quality = evaluateQuality(criticResult.output, outputMode);
        let repairAttempt = 0;

        while (repairAttempt < maxRepairAttempts && this._shouldRepairForQuality(quality, minScore)) {
            repairAttempt += 1;
            const latestViolations = [...steps].reverse().find((step) => step.agent === 'rule_gate')?.violations || [];
            const repairMode = this._shouldEscalateRepair(latestViolations, repairAttempt) ? 'CONSTRAINED_REGENERATE' : 'PATCH_ONLY';
            const repairInput = this._buildPatchRepairPrompt(userInput, steps, outputMode, quality, minScore, repairAttempt, currentArtifact, repairMode);

            this._broadcast('pipeline:quality-repair', {
                attempt: repairAttempt,
                outputMode,
                score: quality.score,
                recommendation: quality.recommendation,
                minScore,
                repairMode,
            });

            codeResult = await this._executeStep('coder', repairInput, steps, logs, customModels.coder, outputMode, currentArtifact, artifactContract);
            this._ensureCoderDeliverable(codeResult, steps, repairInput, outputMode);
            const previousArtifact = currentArtifact;
            currentArtifact = this._publishArtifactSnapshot(runId, codeResult, steps, outputMode);
            this._recordRepairAudit(steps, previousArtifact, currentArtifact, repairMode, 'quality_gate');
            testResult = await this._executeStep('tester', repairInput, steps, logs, customModels.tester, outputMode, currentArtifact, artifactContract);
            criticResult = await this._executeStep('critic', repairInput, steps, logs, customModels.critic, outputMode, currentArtifact, artifactContract);
            criticResult = this._normalizeCriticResult(criticResult, {
                outputMode,
                userInput,
                currentArtifact,
                testOutput: testResult?.output || '',
            });
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

    async _runRuleGate({ runId, userInput, outputMode, steps, logs, customModels, artifactContract, currentArtifact }) {
        const maxRepairAttempts = config.ruleGate?.maxRepairAttempts || 0;
        let attempt = 0;
        let codeResult = { output: currentArtifact?.content || '' };
        let violations = this._validateArtifact(outputMode, currentArtifact?.content || '', artifactContract);

        while (attempt < maxRepairAttempts && violations.length > 0) {
            attempt += 1;
            const repairMode = this._shouldEscalateRepair(violations, attempt) ? 'CONSTRAINED_REGENERATE' : 'PATCH_ONLY';
            this._broadcast('pipeline:rule-gate', {
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
- Violations to fix: ${violations.map((v) => v.code).join(', ')}

You must correct the rule-gate violations and keep as much of the current artifact intent as possible.
If repair mode is PATCH_ONLY, preserve the current structure and patch only the broken areas.
If repair mode is CONSTRAINED_REGENERATE, rebuild the artifact but preserve the same user request, mode contract, and core sections.
Return the corrected final artifact in the required output format.

Violation details:
${violations.map((v) => `- ${v.code}: ${v.message}`).join('\n')}`;

            codeResult = await this._executeStep('coder', patchPrompt, steps, logs, customModels.coder, outputMode, currentArtifact, artifactContract);
            this._ensureCoderDeliverable(codeResult, steps, patchPrompt, outputMode);
            const previousArtifact = currentArtifact;
            currentArtifact = this._publishArtifactSnapshot(runId, codeResult, steps, outputMode);
            this._recordRepairAudit(steps, previousArtifact, currentArtifact, repairMode, 'rule_gate');
            violations = this._validateArtifact(outputMode, currentArtifact.content || '', artifactContract);
        }

        this._recordRuleGateResult(steps, currentArtifact, violations);
        return { codeResult, currentArtifact, violations };
    }

    _recordRuleGateResult(steps, currentArtifact, violations) {
        const step = {
            agent: 'rule_gate',
            role: 'Static Artifact Validation',
            output: violations.length > 0
                ? `Rule gate violations detected for ${currentArtifact?.id || 'unknown artifact'}:\n${violations.map((v) => `- ${v.code}: ${v.message}`).join('\n')}`
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

            // 시맨틱: 인터랙티브 핸들러 존재 여부
            if (!/(onclick|addEventListener|\.addEventListener|onsubmit|handleSubmit|handleClick)/i.test(text)) {
                violations.push({ code: 'NO_INTERACTION_HANDLER', message: 'Website artifact should contain event handlers for interactive behavior.' });
            }

            // 시맨틱: form submit 시 처리 패턴 검사 (login/auth)
            if (/(로그인|login|signin|auth|인증)/i.test(text + ' ' + JSON.stringify(requiredElements))) {
                if (!/(preventDefault|submit|onsubmit)/i.test(text)) {
                    violations.push({ code: 'NO_SUBMIT_HANDLING', message: 'Login/auth form should have submit handling logic.' });
                }
            }
        } else if (outputMode === 'docx' || outputMode === 'deep_research') {
            if (!/(?:<!doctype html>|<html\b)/i.test(text)) {
                violations.push({ code: 'NON_RENDERABLE', message: 'Document artifact must contain a full HTML document root.' });
            }
            const headingCount = (text.match(/<h[1-3]\b/gi) || []).length;
            if (headingCount < 2) {
                violations.push({ code: 'STRUCTURE_MISSING', message: 'Document artifact must include at least two heading sections.' });
            }
            const paragraphCount = (text.match(/<p\b/gi) || []).length;
            if (paragraphCount < 3) {
                violations.push({ code: 'CONTENT_TOO_THIN', message: 'Document artifact must contain multiple content paragraphs.' });
            }

            // 시맨틱: heading hierarchy (h1 → h2 → h3 순서)
            const headings = [...text.matchAll(/<h([1-3])\b/gi)].map((m) => parseInt(m[1]));
            for (let i = 1; i < headings.length; i++) {
                if (headings[i] > headings[i - 1] + 1) {
                    violations.push({ code: 'HEADING_HIERARCHY_SKIP', message: `Heading hierarchy skip: h${headings[i - 1]} → h${headings[i]} at position ${i + 1}.` });
                    break;
                }
            }

            // 시맨틱: h1 단일 여부
            const h1Count = (text.match(/<h1\b/gi) || []).length;
            if (h1Count > 1) {
                violations.push({ code: 'MULTIPLE_H1', message: `Document has ${h1Count} h1 elements; expected exactly 1.` });
            }

            // deep_research 전용: evidence-for/against 양측 필수
            if (outputMode === 'deep_research') {
                if (!/evidence-for/i.test(text)) {
                    violations.push({ code: 'MISSING_EVIDENCE_FOR', message: 'Deep research report must contain evidence-for sections.' });
                }
                if (!/evidence-against/i.test(text)) {
                    violations.push({ code: 'MISSING_EVIDENCE_AGAINST', message: 'Deep research report must contain evidence-against sections.' });
                }
                if (!/knowledge.?gap/i.test(text)) {
                    violations.push({ code: 'MISSING_KNOWLEDGE_GAPS', message: 'Deep research report must contain a knowledge gaps section.' });
                }
            }
        } else if (outputMode === 'sheet') {
            if (!/(?:<!doctype html>|<html\b)/i.test(text)) {
                violations.push({ code: 'NON_RENDERABLE', message: 'Sheet artifact must contain a full HTML document root.' });
            }
            if (!/<table\b/i.test(text)) {
                violations.push({ code: 'STRUCTURE_MISSING', message: 'Sheet artifact must contain a table.' });
            }
            const headerCount = (text.match(/<th\b/gi) || []).length;
            if (headerCount < 2) {
                violations.push({ code: 'HEADER_MISSING', message: 'Sheet artifact must contain at least two table headers.' });
            }
            const rowCount = (text.match(/<tr\b/gi) || []).length;
            if (rowCount < 3) {
                violations.push({ code: 'DATA_REGION_EMPTY', message: 'Sheet artifact must contain header and data rows.' });
            }

            // 시맨틱: total/summary row 존재 여부
            if (!/(total|합계|소계|summary|sum)/i.test(text)) {
                violations.push({ code: 'MISSING_TOTAL_ROW', message: 'Sheet artifact should contain a total or summary row for numeric data.' });
            }

            // 시맨틱: .num 클래스 사용 여부 (숫자 컬럼 정렬)
            if ((text.match(/<td[^>]*>/gi) || []).length > 10 && !/class=["'][^"']*num[^"']*["']/i.test(text)) {
                violations.push({ code: 'MISSING_NUM_CLASS', message: 'Sheet artifact with numeric data should use .num class for right-aligned numeric columns.' });
            }
        } else if (outputMode === 'slide') {
            if (!/(?:<!doctype html>|<html\b)/i.test(text)) {
                violations.push({ code: 'NON_RENDERABLE', message: 'Slide artifact must contain a full HTML document root.' });
            }
            const slideCount = (text.match(/class=["'][^"']*\bslide\b[^"']*["']/gi) || []).length;
            if (slideCount < 3) {
                violations.push({ code: 'SLIDE_COUNT_TOO_LOW', message: 'Slide artifact must contain at least three slides.' });
            }
            if (!/<h1\b/i.test(text)) {
                violations.push({ code: 'TITLE_SLIDE_MISSING', message: 'Slide artifact must contain a title slide heading.' });
            }
            const longTextBlocks = (text.match(/>[^<]{240,}</g) || []).length;
            if (longTextBlocks > 2) {
                violations.push({ code: 'TEXT_DENSITY_TOO_HIGH', message: 'Slide artifact contains overly dense text blocks.' });
            }

            // 시맨틱: slide title uniqueness
            const slideTitles = [...text.matchAll(/<h[12][^>]*>([^<]+)</gi)].map((m) => m[1].trim().toLowerCase());
            const uniqueTitles = new Set(slideTitles);
            if (slideTitles.length > 0 && uniqueTitles.size < slideTitles.length * 0.7) {
                violations.push({ code: 'DUPLICATE_SLIDE_TITLES', message: 'Multiple slides have identical or near-identical titles.' });
            }

            // 시맨틱: repeated content ratio
            const slideBodyTexts = [...text.matchAll(/class=["'][^"']*slide[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]*class=["'][^"']*slide|$)/gi)]
                .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
                .filter((t) => t.length > 20);
            if (slideBodyTexts.length >= 3) {
                const pairs = slideBodyTexts.flatMap((a, i) => slideBodyTexts.slice(i + 1).map((b) => [a, b]));
                const duplicatePairs = pairs.filter(([a, b]) => a === b).length;
                if (duplicatePairs > 1) {
                    violations.push({ code: 'REPEATED_SLIDE_CONTENT', message: 'Multiple slides contain identical body content.' });
                }
            }
        }

        for (const requirement of requiredElements) {
            if (!this._matchesRequiredElement(requirement, text, outputMode)) {
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

    _matchesRequiredElement(requirement, text, outputMode = 'website') {
        const source = String(requirement || '').trim();
        if (!source) return true;

        const normalized = source.toLowerCase().replace(/\s+/g, ' ').trim();
        const html = String(text || '');

        if (source.startsWith('<') || /class=|id=/.test(normalized)) {
            return html.toLowerCase().includes(source.toLowerCase());
        }

        const matchers = [
            {
                test: /email input/,
                match: () => /<input\b[^>]*(type=["']email["']|name=["'][^"']*email[^"']*["']|id=["'][^"']*email[^"']*["']|autocomplete=["']email["'])/i.test(html),
            },
            {
                test: /password input/,
                match: () => /<input\b[^>]*(type=["']password["']|name=["'][^"']*pass[^"']*["']|id=["'][^"']*pass[^"']*["']|autocomplete=["']current-password["'])/i.test(html),
            },
            {
                test: /submit button/,
                match: () => /<(button|input)\b[^>]*(type=["']submit["']|value=["'][^"']*(sign in|login|log in|continue|submit)[^"']*["'])/i.test(html)
                    || /<button\b[^>]*>(?:[\s\S]*?)(sign in|login|log in|continue|submit)(?:[\s\S]*?)<\/button>/i.test(html),
            },
            {
                test: /validation message region/,
                match: () => /(role=["']alert["']|aria-live=["'](?:polite|assertive)["']|class=["'][^"']*(error|validation|message|status)[^"']*["']|id=["'][^"']*(error|validation|message|status)[^"']*["'])/i.test(html),
            },
            {
                test: /success or failure state/,
                match: () => {
                    const hasStatusRegion = /(role=["']alert["']|role=["']status["']|aria-live=["'](?:polite|assertive)["']|class=["'][^"']*(error|success|status|message)[^"']*["']|id=["'][^"']*(error|success|status|message)[^"']*["'])/i.test(html);
                    const hasSuccessToken = /\b(success|succeeded|complete|completed|redirect|dashboard|welcome)\b/i.test(html);
                    const hasFailureToken = /\b(error|failed|failure|invalid|unauthorized|incorrect|retry)\b/i.test(html);
                    return hasStatusRegion && (hasSuccessToken || hasFailureToken);
                },
            },
            {
                test: /\bbutton\b/,
                match: () => /<button\b|<input\b[^>]*type=["']submit["']/i.test(html),
            },
            {
                test: /\binput\b/,
                match: () => /<input\b/i.test(html),
            },
            {
                test: /\bform\b/,
                match: () => /<form\b/i.test(html),
            },
        ];

        for (const matcher of matchers) {
            if (matcher.test.test(normalized)) {
                return matcher.match();
            }
        }

        if (outputMode === 'website') {
            return html.toLowerCase().includes(normalized);
        }

        return html.toLowerCase().includes(normalized);
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

    _extractAssetPlan(planOutput) {
        const parsed = this._extractPlanJson(planOutput);
        return parsed?.assetPlan || null;
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

        if (outputMode === 'docx' || outputMode === 'deep_research') {
            return {
                type: 'self-contained document HTML',
                requiredElements: ['<h1', '<p'],
                forbiddenPatterns: [],
                renderRequirements: ['renderable in a single iframe', 'body must not be empty'],
                assetPolicy: 'mode default',
                reusePolicy: 'reuse existing implementation when present',
                repairStrategy: 'patch existing artifact before full regeneration',
            };
        }

        if (outputMode === 'sheet') {
            return {
                type: 'self-contained spreadsheet HTML',
                requiredElements: ['<table', '<th'],
                forbiddenPatterns: [],
                renderRequirements: ['renderable in a single iframe', 'body must not be empty'],
                assetPolicy: 'mode default',
                reusePolicy: 'reuse existing implementation when present',
                repairStrategy: 'patch existing artifact before full regeneration',
            };
        }

        if (outputMode === 'slide') {
            return {
                type: 'self-contained slide deck HTML',
                requiredElements: ['class="slide"', '<h1'],
                forbiddenPatterns: [],
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

    async getStatus() {
        await this.llmProvider.ensureReady();
        return {
            isRunning: this.isRunning,
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
