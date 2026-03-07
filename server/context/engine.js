import MemoryStore from './memory.js';
import config from '../config.js';

export default class ContextEngine {
    constructor() {
        this.memory = new MemoryStore();
    }

    /**
     * 에이전트 실행 전 최적화된 컨텍스트 구성
     */
    buildContext(agentName, { userInput, previousSteps = [], runId, outputMode = 'website', currentArtifact = null, artifactContract = null }) {
        const modeConfig = config.outputModes[outputMode] || config.outputModes.website;
        const context = {
            previousSteps: this._selectRelevantSteps(agentName, previousSteps, outputMode),
            memory: this._getRelevantMemory(agentName, userInput),
            outputMode,
            currentArtifact,
            artifactContract,
            modeConfig: {
                label: modeConfig.label,
                researchDepth: modeConfig.researchDepth,
                promptFocus: modeConfig.promptFocus,
                contextPriority: modeConfig.contextPriority,
                harnessFocus: modeConfig.harnessFocus,
            },
        };

        return context;
    }

    /**
     * 에이전트별로 관련 있는 이전 단계만 선택 (모드별 최적화)
     */
    _selectRelevantSteps(agentName, previousSteps, outputMode = 'website') {
        // 모드별 컨텍스트 한도 설정
        const modeLimits = {
            website: {
                planner: { steps: 0, chars: 0 },
                researcher: { steps: 1, chars: 3000 },
                asset: { steps: 2, chars: 1200 },
                coder: { steps: 3, chars: 4000 },
                tester: { steps: 3, chars: 6000 },
                critic: { steps: 5, chars: 5000 },
            },
            docx: {
                planner: { steps: 0, chars: 0 },
                researcher: { steps: 1, chars: 1500 },
                coder: { steps: 2, chars: 2500 },
                tester: { steps: 2, chars: 2000 },
                critic: { steps: 4, chars: 1500 },
            },
            sheet: {
                planner: { steps: 0, chars: 0 },
                researcher: { steps: 1, chars: 1200 },
                coder: { steps: 2, chars: 2000 },
                tester: { steps: 2, chars: 2500 },
                critic: { steps: 4, chars: 1500 },
            },
            slide: {
                planner: { steps: 0, chars: 0 },
                researcher: { steps: 1, chars: 1500 },
                asset: { steps: 2, chars: 1200 },
                coder: { steps: 3, chars: 2000 },
                tester: { steps: 2, chars: 1500 },
                critic: { steps: 4, chars: 1500 },
            },
            deep_research: {
                planner: { steps: 0, chars: 0 },
                researcher: { steps: 1, chars: 3000 },
                coder: { steps: 2, chars: 3000 },
                tester: { steps: 2, chars: 2500 },
                critic: { steps: 4, chars: 2000 },
            },
        };

        const limits = modeLimits[outputMode] || modeLimits.website;
        const rule = limits[agentName] || { steps: 3, chars: 1500 };
        const selected = previousSteps.slice(-rule.steps);

        return selected.map((step, index) => ({
            agent: step.agent,
            role: step.role,
            output: this._truncateStepOutput(step.output, rule.chars),
            order: index + 1,
        }));
    }

    _truncateStepOutput(output, maxChars) {
        if (!output || output.length <= maxChars) return output;
        return `${output.slice(0, maxChars)}\n\n...[truncated ${output.length - maxChars} chars]`;
    }

    /**
     * 관련 메모리 조회
     */
    _getRelevantMemory(agentName, userInput) {
        const shortTerm = this.memory.getAllShortTerm();
        if (Object.keys(shortTerm).length === 0) return null;

        let memoryText = '';
        for (const [key, value] of Object.entries(shortTerm)) {
            if (typeof value === 'string') {
                memoryText += `${key}: ${value}\n`;
            } else {
                memoryText += `${key}: ${JSON.stringify(value)}\n`;
            }
        }

        return memoryText || null;
    }

    /**
     * 실행 결과를 메모리에 저장
     */
    storeStepResult(agentName, result) {
        this.memory.setShortTerm(`lastResult_${agentName}`, {
            output: result.output?.substring(0, 500), // 토큰 절약
            success: result.success,
            timestamp: Date.now(),
        });
    }

    /**
     * 전체 실행 결과를 장기 메모리에 저장
     */
    saveRunToLongTerm(runId, runData) {
        this.memory.saveLongTerm(runId, {
            ...runData,
            savedAt: new Date().toISOString(),
        });
    }

    /**
     * 이전 실행 이력 조회
     */
    getHistory(limit = 10) {
        return this.memory.getRecentRuns(limit);
    }

    /**
     * 세션 메모리 초기화
     */
    resetSession() {
        this.memory.clearShortTerm();
    }
}
