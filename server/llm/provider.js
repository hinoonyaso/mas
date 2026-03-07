import { spawn } from 'child_process';

/**
 * CLI Subprocess 기반 LLM Provider
 * 
 * API 호출 대신 CLI 도구를 subprocess로 실행하여
 * 이미 결제한 구독(Gemini, Claude, Codex)을 활용합니다.
 * → 추가 API 비용 없음!
 * 
 * 지원 CLI:
 *   - gemini (Google Gemini CLI)
 *   - claude (Anthropic Claude CLI / Claude Code)
 *   - codex (OpenAI Codex CLI)
 */

class LLMProvider {
    constructor() {
        this.availableProviders = [];
        this.providerDetectionPromise = this._detectProviders();
    }

    /**
     * 설치된 CLI 도구 감지
     */
    async _detectProviders() {
        const checks = [
            { name: 'gemini', cmd: 'gemini', args: ['-h'] },
            { name: 'claude', cmd: 'claude', args: ['--version'] },
            { name: 'codex', cmd: 'codex', args: ['--version'] },
        ];

        for (const check of checks) {
            try {
                await this._exec(check.cmd, check.args, '', 5000);
                this.availableProviders.push(check.name);
            } catch {
                // CLI가 없으면 스킵
            }
        }

        console.log(`[LLM] Detected CLI providers: ${this.availableProviders.join(', ') || 'none (demo mode)'}`);
    }

    getAvailableProviders() {
        return this.availableProviders;
    }

    /**
     * CLI subprocess로 LLM 호출
     */
    async generate(providerName, prompt, options = {}) {
        await this.providerDetectionPromise;

        const startTime = Date.now();
        const systemPrompt = options.systemPrompt || '';

        let text;

        switch (providerName) {
            case 'gemini':
                text = await this._callGemini(prompt, systemPrompt, options.model);
                break;
            case 'claude':
                text = await this._callClaude(prompt, systemPrompt, options.model);
                break;
            case 'codex':
            case 'openai':
                text = await this._callCodex(prompt, systemPrompt, options.model);
                break;
            default:
                throw new Error(`Unknown provider: ${providerName}`);
        }

        const latency = Date.now() - startTime;

        return {
            text,
            inputTokens: Math.floor(prompt.length / 4),
            outputTokens: Math.floor(text.length / 4),
            totalTokens: Math.floor((prompt.length + text.length) / 4),
            latency,
            provider: providerName,
            model: options.model || `${providerName}-cli`,
        };
    }

    /**
     * Gemini CLI 호출
     * echo "prompt" | gemini -p
     * stdin으로 프롬프트를 전달하여 shell escaping 이슈 방지
     */
    async _callGemini(prompt, systemPrompt, model) {
        const fullPrompt = systemPrompt
            ? `${systemPrompt}\n\n---\n\n${prompt}`
            : prompt;

        const args = ['-p', fullPrompt, '--output-format', 'text'];
        if (model) {
            args.unshift('--model', model);
        }

        try {
            return await this._exec('gemini', args, '', 120000);
        } catch (error) {
            if (model && this._shouldRetryGeminiWithoutModel(error)) {
                console.warn(`[LLM] Gemini model "${model}" failed. Retrying with CLI default model.`);
                return this._exec('gemini', ['-p', fullPrompt, '--output-format', 'text'], '', 120000);
            }
            throw error;
        }
    }

    /**
     * Claude CLI 호출
     * echo prompt | claude -p
     */
    async _callClaude(prompt, systemPrompt, model) {
        const fullPrompt = prompt;

        const args = ['-p', '--output-format', 'text', '--dangerously-skip-permissions'];
        if (systemPrompt) {
            args.push('--append-system-prompt', systemPrompt);
        }
        if (model) {
            args.push('--model', model);
        }
        args.push(fullPrompt);

        try {
            return await this._exec('claude', args, '', 120000);
        } catch (error) {
            if (model && this._isModelNotFound(error)) {
                console.warn(`[LLM] Claude model "${model}" not found. Retrying with CLI default model.`);
                const fallbackArgs = ['-p', '--output-format', 'text', '--dangerously-skip-permissions'];
                if (systemPrompt) {
                    fallbackArgs.push('--append-system-prompt', systemPrompt);
                }
                fallbackArgs.push(fullPrompt);
                return this._exec('claude', fallbackArgs, '', 120000);
            }
            throw error;
        }
    }

    /**
     * Codex CLI 호출
     * codex exec "prompt"
     * exec 서브커맨드로 non-interactive 실행
     */
    async _callCodex(prompt, systemPrompt, model) {
        const fullPrompt = systemPrompt
            ? `${systemPrompt}\n\n---\n\n${prompt}`
            : prompt;

        // codex exec requires trusted environment, bypass prompts for automated MAS agent
        const args = ['exec', '--dangerously-bypass-approvals-and-sandbox'];
        if (model) {
            args.push('--model', model);
        }
        args.push(fullPrompt);

        try {
            return await this._exec('codex', args, '', 120000);
        } catch (error) {
            if (model && this._isModelNotFound(error)) {
                console.warn(`[LLM] Codex model "${model}" not found. Retrying with CLI default model.`);
                return this._exec('codex', ['exec', '--dangerously-bypass-approvals-and-sandbox', fullPrompt], '', 120000);
            }
            throw error;
        }
    }

    /**
     * 범용 subprocess 실행
     */
    _exec(command, args, stdin = '', timeout = 120000) {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args, {
                timeout,
                env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
                shell: false,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => { stdout += data.toString(); });
            proc.stderr.on('data', (data) => { stderr += data.toString(); });

            if (stdin) {
                proc.stdin.write(stdin);
            }
            proc.stdin.end();

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
                    reject(new Error(`${command} exited with code ${code}: ${details}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to run ${command}: ${err.message}`));
            });
        });
    }

    _isGeminiModelNotFound(error) {
        const message = error?.message || '';
        return message.includes('ModelNotFoundError') || message.includes('Requested entity was not found');
    }

    _shouldRetryGeminiWithoutModel(error) {
        const message = error?.message || '';
        return this._isGeminiModelNotFound(error)
            || message.includes('Thinking_config.include_thoughts')
            || message.includes('INVALID_ARGUMENT')
            || message.includes('gemini exited with code 1');
    }

    _isModelNotFound(error) {
        const message = (error?.message || '').toLowerCase();
        return message.includes('modelnotfounderror')
            || message.includes('requested entity was not found')
            || (message.includes('model') && message.includes('not found'))
            || (message.includes('unknown model'));
    }
}

/**
 * Demo 모드 (CLI가 없을 때 폴백)
 */
class DemoLLMProvider extends LLMProvider {
    constructor() {
        super();
    }

    async generate(providerName, prompt, options = {}) {
        await this.providerDetectionPromise;

        // CLI가 있으면 실제 CLI 호출
        if (this.availableProviders.includes(providerName)) {
            return super.generate(providerName, prompt, options);
        }

        // 없으면 Demo 시뮬레이션
        const startTime = Date.now();
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));

        const agentName = options.agentName || 'unknown';
        const demoText = this._getDemoResponse(agentName, prompt);

        return {
            text: demoText,
            inputTokens: Math.floor(prompt.length / 4),
            outputTokens: Math.floor(demoText.length / 4),
            totalTokens: Math.floor((prompt.length + demoText.length) / 4),
            latency: Date.now() - startTime,
            provider: providerName + ' (demo)',
            model: 'demo-mode',
        };
    }

    _getDemoResponse(agentName, prompt = '') {
        const lowerPrompt = String(prompt || '').toLowerCase();
        const isLogin = /login|signin|signup|auth|로그인|인증|회원가입/.test(lowerPrompt);

        const plannerResponse = JSON.stringify({
            tasks: isLogin ? [
                {
                    id: 1,
                    name: 'Extract auth page contract and constraints',
                    agent: 'researcher',
                    description: 'Identify the required login form structure, validation states, post-submit behavior, and any existing implementation cues.',
                    dependsOn: [],
                    deliverable: 'Request-specific login constraints and reuse notes.',
                    acceptanceChecks: ['Required form fields are enumerated', 'Demo-only limitations are called out explicitly'],
                },
                {
                    id: 2,
                    name: 'Implement self-contained login artifact',
                    agent: 'coder',
                    description: 'Build a single previewable HTML login page that follows the contract, including inline CSS/JS and explicit submit states.',
                    dependsOn: [1],
                    deliverable: 'One self-contained HTML document.',
                    acceptanceChecks: ['HTML is directly renderable', 'Form, validation, and submit states exist'],
                },
                {
                    id: 3,
                    name: 'Validate login behavior and contract compliance',
                    agent: 'tester',
                    description: 'Check form presence, validation logic, submit flow, accessibility hooks, and whether the success path is real or mocked.',
                    dependsOn: [2],
                    deliverable: 'Concrete pass/fail report with evidence.',
                    acceptanceChecks: ['At least 6 concrete checks', 'Missing or mocked behavior is flagged'],
                },
                {
                    id: 4,
                    name: 'Score demo quality versus production readiness',
                    agent: 'critic',
                    description: 'Review planner/researcher usefulness, implementation quality, and whether the result is only a demo or credible for production.',
                    dependsOn: [1, 2, 3],
                    deliverable: 'Conservative quality assessment.',
                    acceptanceChecks: ['Separate demo quality from production readiness', 'Do not overrate polished mockups'],
                },
            ] : [
                {
                    id: 1,
                    name: 'Extract request-specific constraints',
                    agent: 'researcher',
                    description: 'Turn the request into concrete requirements, reuse opportunities, and risks.',
                    dependsOn: [],
                    deliverable: 'Structured implementation constraints.',
                    acceptanceChecks: ['Generic advice is avoided'],
                },
                {
                    id: 2,
                    name: 'Implement the contracted artifact',
                    agent: 'coder',
                    description: 'Produce the required self-contained deliverable.',
                    dependsOn: [1],
                    deliverable: 'User-facing artifact.',
                    acceptanceChecks: ['Artifact matches contract'],
                },
                {
                    id: 3,
                    name: 'Validate structure and behavior',
                    agent: 'tester',
                    description: 'Check the artifact against the contract with evidence.',
                    dependsOn: [2],
                    deliverable: 'Evidence-based test report.',
                    acceptanceChecks: ['Concrete checks and failures listed'],
                },
                {
                    id: 4,
                    name: 'Assess quality conservatively',
                    agent: 'critic',
                    description: 'Score the result with separate attention to contract compliance and production readiness.',
                    dependsOn: [1, 2, 3],
                    deliverable: 'Final review and recommendation.',
                    acceptanceChecks: ['No inflated score'],
                },
            ],
            summary: isLogin
                ? 'Plan focuses on a concrete login-page contract, evidence-based testing, and conservative quality scoring.'
                : 'Plan focuses on request-specific constraints, contracted implementation, and evidence-based validation.',
            finalArtifactContract: {
                type: 'single self-contained HTML document',
                purpose: isLogin ? 'Authenticate a user through a credible login UI flow' : 'Deliver a directly previewable user-facing artifact',
                requiredElements: isLogin
                    ? ['<form', 'email input', 'password input', 'submit button', 'validation message region', 'success or failure state']
                    : ['<main', '<style'],
                forbiddenPatterns: ['external css link', 'external script src', 'generic placeholder copy', ...(isLogin ? ['fake success flow without marking it demo-only'] : [])],
                renderRequirements: ['renderable in a single iframe', 'body must not be empty'],
                assetPolicy: 'reuse existing asset first, generated asset second, deterministic fallback last',
                reusePolicy: 'reuse existing implementation when present',
                repairStrategy: 'patch existing artifact before full regeneration',
                qualityBar: {
                    demoQuality: 'Polished UI, coherent layout, clear states, no broken controls',
                    productionReadiness: isLogin
                        ? 'Requires real API integration, non-placeholder links, and explicit post-login navigation'
                        : 'Requires real data flow and absence of obvious placeholder behavior',
                },
            },
            executionNotes: {
                primaryRisks: isLogin
                    ? ['Mocked authentication may look complete but is not production-ready', 'Missing validation states reduce trust']
                    : ['Artifact may satisfy visuals but miss functional expectations'],
                openQuestionsOrAssumptions: ['Assume self-contained preview is preferred unless the request explicitly demands backend integration'],
                testerFocus: isLogin
                    ? ['form presence', 'field validation', 'submit/loading state', 'success/failure branch', 'redirect or next-step behavior', 'accessibility hooks']
                    : ['contract compliance', 'behavioral completeness'],
                criticFocus: ['contract compliance', 'demo quality', 'production readiness', 'pipeline coherence'],
            },
        }, null, 2);

        const responses = {
            planner: plannerResponse,
            researcher: isLogin
                ? `## Research Findings

### Request-Specific Constraints
- The artifact should behave like a login page, not a generic marketing card.
- The flow needs visible email/password inputs, submit state, validation messaging, and a clear success or failure path.
- If authentication is mocked, that limitation must be explicit so the critic/tester can score it correctly.

### Reuse Opportunities
- Reuse any existing auth layout, input styling, and button state patterns before inventing a new structure.
- Reuse existing background or brand assets only if they can stay self-contained in the preview artifact.

### UX and Content Decisions
- Required sections: brand/context header, login form, supporting action row, and status/error region.
- Required interactions: invalid email handling, empty-password handling, submit loading state, optional password visibility toggle, and post-submit next-step behavior.
- Avoid placeholder actions like "#" links unless labeled as demo-only.

### Asset and Visual Guidance
- Prefer existing auth-themed assets; fall back to a deterministic gradient or illustration if none are reliable.
- Keep all CSS and JS inline for single-file preview compatibility.

### Handoff to Coder
1. Build the form around a real submit flow with explicit success and failure branches.
2. If backend integration is unavailable, mark the flow as demo behavior instead of pretending it is real.

### Handoff to Tester
- Verify form structure, field validation, submit/loading behavior, a11y labels, and whether success leads anywhere real.

### Risks and Unknowns
- The biggest risk is a polished UI masking fake auth behavior.
- It is unclear whether a backend endpoint is required, so the artifact must state its limitation if it stays mock-only.`
                : `## Research Findings

### Request-Specific Constraints
- Convert the request into explicit structure and interaction requirements before implementation.

### Reuse Opportunities
- Reuse any existing implementation patterns that already match the requested artifact.

### UX and Content Decisions
- Enumerate the sections, states, and copy requirements the coder must satisfy.

### Asset and Visual Guidance
- Keep the preview self-contained and prefer deterministic assets.

### Handoff to Coder
1. Implement only what is required by the contract.
2. Avoid placeholder behaviors that look functional but are not.

### Handoff to Tester
- Check contract compliance with concrete evidence.

### Risks and Unknowns
- Generic implementation choices will lower pipeline coherence.`,
            asset: JSON.stringify(
                isLogin
                    ? { generate: false }
                    : {
                        generate: true,
                        filename: 'ui-support-visual.png',
                        prompt: 'modern product interface support graphic, abstract geometric composition, clean editorial lighting, teal and slate palette, premium SaaS aesthetic, wide background illustration',
                    },
                null,
                2,
            ),
            coder: `## Implementation\n\n\`\`\`javascript\nclass Solution {\n  constructor(config) {\n    this.config = config;\n  }\n\n  async execute(input) {\n    const result = this.process(input);\n    return { success: true, data: result };\n  }\n\n  process(input) {\n    return { processed: true, input };\n  }\n}\n\nexport default Solution;\n\`\`\``,
            tester: isLogin
                ? `## Test Results

### Contract Checks
| # | Check | Status | Evidence | Severity |
|---|-------|--------|----------|----------|
| 1 | Login form exists | PASS | Artifact includes a <form> container for auth input | HIGH |
| 2 | Email and password inputs exist | PASS | Both fields are present in the form structure | HIGH |
| 3 | Validation messaging is explicit | FAIL | No reliable evidence of invalid-email and empty-password messages | HIGH |
| 4 | Submit/loading state exists | FAIL | No concrete loading state or disabled-submit evidence is shown | MEDIUM |
| 5 | Success/failure branches are distinguishable | FAIL | Demo flow does not prove real backend success/failure handling | HIGH |
| 6 | External references are avoided | PASS | No external stylesheet/script requirement is implied in the preview contract | MEDIUM |

### Behavioral Checks
| # | Behavior | Status | Evidence | Severity |
|---|----------|--------|----------|----------|
| 1 | Invalid input handling | FAIL | Behavior not proven by artifact evidence | HIGH |
| 2 | Post-submit next action | FAIL | No redirect or next-step behavior is verified | HIGH |
| 3 | Accessibility hooks | NEEDS_REVISION | Labels and status semantics are not fully evidenced | MEDIUM |

### Edge Cases
- Empty email/password submission handling is not proven
- Remember-me state may exist visually but not behaviorally

### Failures and Risks
- A polished auth UI can still be functionally demo-only
- Missing validation evidence should block a PASS result

### Overall Result
- **Status**: NEEDS_REVISION
- **Confidence**: MEDIUM`
                : `## Test Results

### Contract Checks
| # | Check | Status | Evidence | Severity |
|---|-------|--------|----------|----------|
| 1 | Artifact matches requested mode | PASS | Output is presented as a user-facing artifact | HIGH |
| 2 | Contract-specific behavior is fully proven | FAIL | Evidence is incomplete and too generic | HIGH |

### Behavioral Checks
| # | Behavior | Status | Evidence | Severity |
|---|----------|--------|----------|----------|
| 1 | Core request behavior | NEEDS_REVISION | Behavior is only partially evidenced | HIGH |

### Edge Cases
- Important edge cases are not concretely validated

### Failures and Risks
- Generic PASS language would overstate confidence

### Overall Result
- **Status**: NEEDS_REVISION
- **Confidence**: MEDIUM`,
            critic: isLogin
                ? `## Quality Assessment

### Score: 6.6/10

### Review Summary
The artifact may be a decent login mockup, but the pipeline evidence is not strong enough to treat it as a high-confidence orchestration win.

### Rubric Scores
| Dimension | Score | Notes |
|-----------|-------|-------|
| Contract Compliance | 6/10 | Core auth structure exists, but behavioral requirements are not fully proven |
| Demo Quality | 8/10 | Likely polished enough for a preview |
| Production Readiness | 4/10 | Mocked auth, placeholder actions, and unclear next-step behavior block production confidence |
| Pipeline Coherence | 5/10 | Planner/research/test outputs are only moderately useful and not rigorous enough |

### Strengths
- User-facing artifact likely renders cleanly
- The request is at least translated into a recognizable login UI

### Weaknesses
- Demo quality is being mistaken for production readiness
- Tester evidence is incomplete
- Planner and researcher outputs leave too much guesswork to the coder

### Improvement Suggestions
1. Tighten the planner contract around required auth states and prohibited fake behaviors.
2. Require the tester to prove validation, submit state, and post-submit handling with evidence.

### Pipeline Review
- Planning Quality: 4/10 because the task breakdown is still too generic without a strict contract.
- Research Quality: 4/10 because reuse/UX constraints are underdeveloped.
- Implementation Quality: 7/10 because the artifact can still be decent as a demo.
- Test Quality: 5/10 because the report is not strict enough.

### Final Recommendation
**NEEDS_REVISION**

The result can be acceptable as a demo preview, but it should not be overrated as production-ready or as proof of a mature pipeline.`
                : `## Quality Assessment

### Score: 6.8/10

### Review Summary
The artifact may be usable, but the pipeline evidence is not detailed enough to justify a high score.

### Rubric Scores
| Dimension | Score | Notes |
|-----------|-------|-------|
| Contract Compliance | 6/10 | Some contract alignment exists but is not fully evidenced |
| Demo Quality | 7/10 | Reasonable preview quality |
| Production Readiness | 5/10 | Functional confidence is limited |
| Pipeline Coherence | 5/10 | Upstream agent rigor is still weak |

### Strengths
- The artifact appears user-facing rather than purely analytical

### Weaknesses
- Planner and tester evidence remain too generic
- The score should stay conservative until the pipeline becomes more rigorous

### Improvement Suggestions
1. Strengthen request-specific planning.
2. Require evidence-based testing.

### Pipeline Review
- Planning Quality: 4/10 with insufficient contract detail.
- Research Quality: 4/10 with limited actionable guidance.
- Implementation Quality: 7/10 because the artifact may still be decent.
- Test Quality: 5/10 because evidence is thin.

### Final Recommendation
**NEEDS_REVISION**

The result is acceptable as an intermediate demo, not a strong proof of production-grade orchestration.`,
        };
        return responses[agentName] || `Demo response for ${agentName}: Processing complete.`;
    }
}

export { LLMProvider, DemoLLMProvider };
