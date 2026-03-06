import { analyzeExecutionPath, calculatePipelineMetrics, evaluateQuality } from './metrics.js';

export default class Evaluator {
    constructor() {
        this.evaluations = [];
    }

    /**
     * 전체 파이프라인 실행 결과를 평가
     */
    evaluate(runResult) {
        const { logs, finalOutput, criticOutput, outputMode = 'website', steps = [] } = runResult;

        const pipelineMetrics = calculatePipelineMetrics(logs);
        const qualityAssessment = evaluateQuality(criticOutput, outputMode);
        const executionPath = analyzeExecutionPath(steps);

        const evaluation = {
            timestamp: new Date().toISOString(),
            outputMode,
            pipelineMetrics,
            quality: qualityAssessment,
            executionPath,
            summary: this._generateSummary(pipelineMetrics, qualityAssessment, executionPath, outputMode),
        };

        this.evaluations.push(evaluation);
        return evaluation;
    }

    _generateSummary(metrics, quality, executionPath, outputMode = 'website') {
        const parts = [];

        const modeLabels = {
            website: '🌐 Website',
            docx: '📄 Document',
            sheet: '📊 Spreadsheet',
            slide: '📽️ Presentation',
            deep_research: '🔬 Deep Research',
        };

        parts.push(`Mode: ${modeLabels[outputMode] || outputMode}`);

        // 성공률
        parts.push(`Success Rate: ${metrics.successRate.toFixed(0)}%`);

        // 총 지연
        parts.push(`Total Latency: ${(metrics.totalLatency / 1000).toFixed(1)}s`);

        // 토큰 사용
        parts.push(`Total Tokens: ${metrics.totalTokens}`);

        // 비용
        parts.push(`Est. Cost: $${metrics.estimatedCost}`);

        // 품질 점수
        parts.push(`Quality: ${quality.score}/10 (${quality.recommendation})`);

        if (executionPath.ruleGateRepairUsed) {
            parts.push(`Rule Repair: ${executionPath.ruleGateRepairUsed ? 'yes' : 'no'}`);
        }
        if (executionPath.qualityGateRepairUsed) {
            parts.push(`Quality Repair: ${executionPath.qualityRepairCount}`);
        }
        if (executionPath.fallbackUsed) {
            parts.push('Fallback: yes');
        }

        return parts.join(' | ');
    }

    getHistory() {
        return this.evaluations;
    }

    getLatestEvaluation() {
        return this.evaluations[this.evaluations.length - 1] || null;
    }
}
