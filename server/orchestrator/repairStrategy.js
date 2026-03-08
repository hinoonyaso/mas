/**
 * repairStrategy.js — rule gate 루프, quality gate 루프, 복구 프롬프트, escalation
 */

import config from '../config.js';
import { ensureRenderableOutput } from '../artifacts/preview.js';
import { evaluateQuality } from '../harness/metrics.js';
import { validateArtifact } from './artifactValidator.js';

export function createRepairStrategy({ executeStep, publishArtifactSnapshot, broadcast }) {
    function hasRenderableCoderOutput(output, outputMode = 'website') {
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

    function ensureCoderDeliverable(codeResult, steps, userInput, outputMode) {
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

    async function repairCoderIfNeeded(codeResult, userInput, outputMode, steps, logs, customModels, artifactContract) {
        if (hasRenderableCoderOutput(codeResult.output, outputMode)) {
            return codeResult;
        }

        const repairPrompt = `${userInput}

CODER RECOVERY INSTRUCTION
- Your previous response was empty or not renderable.
- You must now return a user-facing artifact, not explanation.
- Output mode: ${outputMode}
- Return a directly previewable deliverable.
- For website mode, return exactly one self-contained html code block.`;

        return executeStep('coder', repairPrompt, steps, logs, customModels.coder, outputMode, null, artifactContract);
    }

    function shouldEscalateRepair(violations, attempt) {
        const severeCodes = new Set([
            'EMPTY_OUTPUT',
            'NON_RENDERABLE',
            'STRUCTURE_MISSING',
            'SLIDE_COUNT_TOO_LOW',
            'DATA_REGION_EMPTY',
        ]);
        const severeCount = violations.filter((v) => severeCodes.has(v.code)).length;
        return severeCount >= 2 || violations.length >= 4 || attempt > 1;
    }

    function buildPatchRepairPrompt(userInput, steps, outputMode, quality, minScore, repairAttempt, currentArtifact, repairMode) {
        const testerOutput = [...steps].reverse().find((s) => s.agent === 'tester')?.output || 'No tester feedback.';
        const criticOutput = [...steps].reverse().find((s) => s.agent === 'critic')?.output || 'No critic feedback.';

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

    function recordRuleGateResult(steps, currentArtifact, violations) {
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

    return {
        hasRenderableCoderOutput,
        ensureCoderDeliverable,
        repairCoderIfNeeded,

        async runRuleGate({ runId, userInput, outputMode, steps, logs, customModels, artifactContract, currentArtifact }) {
            const maxRepairAttempts = config.ruleGate?.maxRepairAttempts || 0;
            let attempt = 0;
            let codeResult = { output: currentArtifact?.content || '' };
            let violations = validateArtifact(outputMode, currentArtifact?.content || '', artifactContract);
            const patchModel = customModels.patch_coder || customModels.coder;

            while (attempt < maxRepairAttempts && violations.length > 0) {
                attempt += 1;
                const repairMode = shouldEscalateRepair(violations, attempt) ? 'CONSTRAINED_REGENERATE' : 'PATCH_ONLY';
                broadcast('pipeline:rule-gate', {
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

                codeResult = await executeStep('patch_coder', patchPrompt, steps, logs, patchModel, outputMode, currentArtifact, artifactContract);
                ensureCoderDeliverable(codeResult, steps, patchPrompt, outputMode);
                currentArtifact = publishArtifactSnapshot(runId, codeResult, steps, outputMode);
                violations = validateArtifact(outputMode, currentArtifact.content || '', artifactContract);
            }

            recordRuleGateResult(steps, currentArtifact, violations);
            return { codeResult, currentArtifact, violations };
        },

        async runQualityGate({ runId, userInput, outputMode, steps, logs, customModels, artifactContract, codeResult, testResult, criticResult, currentArtifact }) {
            const minScore = config.qualityGate?.minScore || 8.5;
            const maxRepairAttempts = config.qualityGate?.maxRepairAttempts || 0;
            let quality = evaluateQuality(criticResult.output, outputMode);
            let repairAttempt = 0;
            const patchModel = customModels.patch_coder || customModels.coder;
            const shouldRepair = (q) => q.score < minScore || q.recommendation === 'REJECTED' || q.recommendation === 'NEEDS_REVISION';

            while (repairAttempt < maxRepairAttempts && shouldRepair(quality)) {
                repairAttempt += 1;
                const latestViolations = [...steps].reverse().find((s) => s.agent === 'rule_gate')?.violations || [];
                const repairMode = shouldEscalateRepair(latestViolations, repairAttempt) ? 'CONSTRAINED_REGENERATE' : 'PATCH_ONLY';
                const repairInput = buildPatchRepairPrompt(userInput, steps, outputMode, quality, minScore, repairAttempt, currentArtifact, repairMode);

                broadcast('pipeline:quality-repair', {
                    attempt: repairAttempt,
                    outputMode,
                    score: quality.score,
                    recommendation: quality.recommendation,
                    minScore,
                    repairMode,
                });

                codeResult = await executeStep('patch_coder', repairInput, steps, logs, patchModel, outputMode, currentArtifact, artifactContract);
                ensureCoderDeliverable(codeResult, steps, repairInput, outputMode);
                currentArtifact = publishArtifactSnapshot(runId, codeResult, steps, outputMode);
                testResult = await executeStep('tester', repairInput, steps, logs, customModels.tester, outputMode, currentArtifact, artifactContract);
                criticResult = await executeStep('critic', repairInput, steps, logs, customModels.critic, outputMode, currentArtifact, artifactContract);
                quality = evaluateQuality(criticResult.output, outputMode);
            }

            return { codeResult, testResult, criticResult, currentArtifact };
        },
    };
}
