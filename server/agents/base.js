import { v4 as uuidv4 } from 'uuid';

export default class BaseAgent {
    constructor({ name, role, systemPrompt, llmProvider, providerName }) {
        this.id = uuidv4();
        this.name = name;
        this.role = role;
        this.systemPrompt = systemPrompt;
        this.llmProvider = llmProvider;
        this.providerName = providerName;
        this.logs = [];
    }

    async execute(input, context = {}, model = null) {
        const startTime = Date.now();
        const log = {
            id: uuidv4(),
            agent: this.name,
            role: this.role,
            provider: this.providerName,
            startTime: new Date().toISOString(),
            status: 'running',
        };

        try {
            const outputMode = context.outputMode || 'website';

            // 출력 모드에 맞는 시스템 프롬프트 생성
            const systemPrompt = this.getSystemPromptForMode(outputMode);

            // 컨텍스트와 입력을 결합하여 프롬프트 생성
            const prompt = this.buildPrompt(input, context, outputMode);

            const result = await this.llmProvider.generate(this.providerName, prompt, {
                systemPrompt,
                agentName: this.name,
                temperature: this.getTemperatureForMode(outputMode),
                model: model,
            });

            log.status = 'completed';
            log.output = result.text;
            log.metrics = {
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                totalTokens: result.totalTokens,
                latency: result.latency,
                provider: result.provider,
                model: result.model,
            };

            this.logs.push(log);
            return { success: true, output: result.text, log };
        } catch (error) {
            log.status = 'error';
            log.error = error.message;
            log.metrics = { latency: Date.now() - startTime };
            this.logs.push(log);
            return { success: false, output: null, error: error.message, log };
        }
    }

    /**
     * 모드별 시스템 프롬프트 반환 (서브클래스에서 오버라이드)
     */
    getSystemPromptForMode(outputMode) {
        return this.systemPrompt;
    }

    buildPrompt(input, context, outputMode) {
        let prompt = '';

        if (context.previousSteps && context.previousSteps.length > 0) {
            prompt += '## Previous Agent Results\n\n';
            for (const step of context.previousSteps) {
                prompt += `### ${step.agent} (${step.role})\n${step.output}\n\n`;
            }
        }

        if (context.memory) {
            prompt += `## Relevant Memory\n${context.memory}\n\n`;
        }

        if (outputMode && outputMode !== 'website') {
            prompt += `## Output Mode\nTarget output format: **${outputMode}**\n\n`;
        }

        prompt += `## Current Task\n${input}\n`;

        return prompt;
    }

    getTemperature() {
        return 0.7;
    }

    /**
     * 모드별 temperature 반환 (서브클래스에서 오버라이드 가능)
     */
    getTemperatureForMode(outputMode) {
        return this.getTemperature();
    }

    getLogs() {
        return this.logs;
    }

    getLastLog() {
        return this.logs[this.logs.length - 1] || null;
    }
}
