import { calculatePipelineMetrics, evaluateQuality } from './metrics.js';

export default class Evaluator {
    constructor() {
        this.evaluations = [];
    }

    /**
     * 전체 파이프라인 실행 결과를 평가
     */
    evaluate(runResult) {
        const { logs, finalOutput, criticOutput } = runResult;

        const pipelineMetrics = calculatePipelineMetrics(logs);
        const qualityAssessment = evaluateQuality(criticOutput);

        const evaluation = {
            timestamp: new Date().toISOString(),
            pipelineMetrics,
            quality: qualityAssessment,
            summary: this._generateSummary(pipelineMetrics, qualityAssessment),
        };

        this.evaluations.push(evaluation);
        return evaluation;
    }

    _generateSummary(metrics, quality) {
        const parts = [];

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

        return parts.join(' | ');
    }

    getHistory() {
        return this.evaluations;
    }

    getLatestEvaluation() {
        return this.evaluations[this.evaluations.length - 1] || null;
    }
}
