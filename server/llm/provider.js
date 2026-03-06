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

    _getDemoResponse(agentName) {
        const responses = {
            planner: JSON.stringify({
                tasks: [
                    { id: 1, name: 'Research & Analysis', agent: 'researcher', description: 'Gather relevant information and context' },
                    { id: 2, name: 'Implementation', agent: 'coder', description: 'Write the solution based on research' },
                    { id: 3, name: 'Testing', agent: 'tester', description: 'Verify correctness and edge cases' },
                    { id: 4, name: 'Review', agent: 'critic', description: 'Final quality assessment' },
                ],
                summary: 'Task decomposed into 4 sequential steps for systematic execution.',
            }, null, 2),
            researcher: `## Research Findings\n\n### Key Points\n- The request involves creating a structured solution\n- Multiple approaches are viable\n- Best practices suggest modular design\n\n### Recommendations\n1. Use established patterns for reliability\n2. Ensure proper error handling\n3. Consider scalability from the start`,
            coder: `## Implementation\n\n\`\`\`javascript\nclass Solution {\n  constructor(config) {\n    this.config = config;\n  }\n\n  async execute(input) {\n    const result = this.process(input);\n    return { success: true, data: result };\n  }\n\n  process(input) {\n    return { processed: true, input };\n  }\n}\n\nexport default Solution;\n\`\`\``,
            tester: `## Test Results\n\n| # | Test Case | Status |\n|---|-----------|--------|\n| 1 | Initialization | ✅ PASS |\n| 2 | Core execution | ✅ PASS |\n| 3 | Error handling | ✅ PASS |\n| 4 | Edge cases | ✅ PASS |\n\n**Overall: 4/4 tests passed**`,
            critic: `## Quality Assessment\n\n### Score: 8.5/10\n\n### Strengths\n- Clean architecture\n- Proper error handling\n- Good test coverage\n\n### Recommendation\n**APPROVED** - Solution meets quality standards.`,
        };
        return responses[agentName] || `Demo response for ${agentName}: Processing complete.`;
    }
}

export { LLMProvider, DemoLLMProvider };
