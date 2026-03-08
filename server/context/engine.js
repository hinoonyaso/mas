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
                spec_builder: { steps: 1, chars: 700 },
                researcher: { steps: 2, chars: 900 },
                asset: { steps: 2, chars: 900 },
                coder: { steps: 4, chars: 1200 },
                patch_coder: { steps: 4, chars: 1200 },
                tester: { steps: 3, chars: 1400 },
                critic: { steps: 4, chars: 1200 },
            },
            docx: {
                planner: { steps: 0, chars: 0 },
                spec_builder: { steps: 1, chars: 700 },
                researcher: { steps: 2, chars: 1000 },
                coder: { steps: 3, chars: 1400 },
                patch_coder: { steps: 3, chars: 1200 },
                tester: { steps: 2, chars: 1200 },
                critic: { steps: 4, chars: 1200 },
            },
            sheet: {
                planner: { steps: 0, chars: 0 },
                spec_builder: { steps: 1, chars: 700 },
                researcher: { steps: 2, chars: 900 },
                coder: { steps: 3, chars: 1200 },
                patch_coder: { steps: 3, chars: 1100 },
                tester: { steps: 2, chars: 1200 },
                critic: { steps: 4, chars: 1100 },
            },
            slide: {
                planner: { steps: 0, chars: 0 },
                spec_builder: { steps: 1, chars: 700 },
                researcher: { steps: 2, chars: 1000 },
                asset: { steps: 2, chars: 900 },
                coder: { steps: 4, chars: 1200 },
                patch_coder: { steps: 4, chars: 1200 },
                tester: { steps: 2, chars: 1200 },
                critic: { steps: 4, chars: 1100 },
            },
            deep_research: {
                planner: { steps: 0, chars: 0 },
                spec_builder: { steps: 1, chars: 800 },
                researcher: { steps: 2, chars: 1400 },
                coder: { steps: 3, chars: 1500 },
                patch_coder: { steps: 3, chars: 1200 },
                tester: { steps: 2, chars: 1200 },
                critic: { steps: 4, chars: 1200 },
            },
        };

        const limits = modeLimits[outputMode] || modeLimits.website;
        const rule = limits[agentName] || { steps: 3, chars: 1500 };
        const selected = previousSteps.slice(-rule.steps);

        return selected.map((step, index) => {
            const operational = step.operational || this._buildOperationalSummary(step, rule.chars);
            return {
                agent: step.agent,
                role: step.role,
                decisionSummary: operational.decisionSummary,
                constraintsForNextStep: operational.constraintsForNextStep,
                openIssues: operational.openIssues,
                output: this._truncateStepOutput(step.output, Math.min(rule.chars, 320)),
                order: index + 1,
            };
        });
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

        const records = Object.entries(shortTerm)
            .filter(([key]) => key.startsWith('operational_'))
            .map(([, value]) => value)
            .filter(Boolean)
            .slice(-4);

        return records.length > 0 ? records : null;
    }

    /**
     * 실행 결과를 메모리에 저장
     */
    storeStepResult(agentName, result) {
        const output = String(result.output || '');
        const operational = this._buildOperationalSummary({
            agent: agentName,
            role: result.log?.role || agentName,
            output,
            success: result.success,
            error: result.error || null,
        }, 500);

        this.memory.setShortTerm(`operational_${agentName}`, {
            agent: agentName,
            decisionSummary: operational.decisionSummary,
            constraintsForNextStep: operational.constraintsForNextStep,
            openIssues: operational.openIssues,
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

    _buildOperationalSummary(step, maxChars = 500) {
        const text = this._truncateStepOutput(String(step?.output || step?.error || ''), maxChars);
        const lines = text
            .split('\n')
            .map((line) => line.replace(/^[-*#>\s]+/, '').trim())
            .filter(Boolean);

        const decisionSummary = lines.slice(0, 3);
        const constraintsForNextStep = lines
            .filter((line) => /(must|should|require|forbid|avoid|exactly|return|include|exclude|single-file|self-contained|responsive|table|html|cta|section)/i.test(line))
            .slice(0, 3);
        const openIssues = [
            ...(step?.success === false && step?.error ? [String(step.error)] : []),
            ...lines.filter((line) => /(risk|issue|missing|fail|warning|unknown|uncertain|blocked|gap)/i.test(line)).slice(0, 2),
        ].slice(0, 3);

        return {
            decisionSummary,
            constraintsForNextStep,
            openIssues,
        };
    }
}
