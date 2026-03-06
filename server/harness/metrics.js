export function calculateMetrics(agentLog) {
    return {
        latency: agentLog.metrics?.latency || 0,
        inputTokens: agentLog.metrics?.inputTokens || 0,
        outputTokens: agentLog.metrics?.outputTokens || 0,
        totalTokens: agentLog.metrics?.totalTokens || 0,
        provider: agentLog.metrics?.provider || 'unknown',
        model: agentLog.metrics?.model || 'unknown',
        success: agentLog.status === 'completed',
    };
}

export function calculatePipelineMetrics(allLogs) {
    const metrics = {
        totalLatency: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        agentCount: allLogs.length,
        successCount: 0,
        failCount: 0,
        agents: {},
        estimatedCost: 0,
    };

    for (const log of allLogs) {
        const m = calculateMetrics(log);
        metrics.totalLatency += m.latency;
        metrics.totalInputTokens += m.inputTokens;
        metrics.totalOutputTokens += m.outputTokens;
        metrics.totalTokens += m.totalTokens;

        if (m.success) metrics.successCount++;
        else metrics.failCount++;

        metrics.agents[log.agent] = m;
    }

    // 대략적 비용 추정 (USD)
    metrics.estimatedCost = estimateCost(allLogs);

    metrics.successRate = metrics.agentCount > 0
        ? (metrics.successCount / metrics.agentCount) * 100
        : 0;

    return metrics;
}

function estimateCost(logs) {
    let cost = 0;
    const pricing = {
        'gemini': { input: 0.00015, output: 0.0006 }, // per 1K tokens 
        'openai': { input: 0.005, output: 0.015 },
        'claude': { input: 0.003, output: 0.015 },
    };

    for (const log of logs) {
        const provider = log.metrics?.provider?.replace(' (demo)', '') || 'gemini';
        const p = pricing[provider] || pricing.gemini;
        const inputK = (log.metrics?.inputTokens || 0) / 1000;
        const outputK = (log.metrics?.outputTokens || 0) / 1000;
        cost += inputK * p.input + outputK * p.output;
    }

    return Math.round(cost * 10000) / 10000; // 4 decimal places
}

export function evaluateQuality(criticOutput) {
    if (!criticOutput) return { score: 0, recommendation: 'N/A' };

    // 스코어 추출 시도
    const scoreMatch = criticOutput.match(/Score:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 7;

    // 추천 결과 추출
    let recommendation = 'UNKNOWN';
    if (/APPROVED/i.test(criticOutput)) recommendation = 'APPROVED';
    else if (/NEEDS_REVISION/i.test(criticOutput)) recommendation = 'NEEDS_REVISION';
    else if (/REJECTED/i.test(criticOutput)) recommendation = 'REJECTED';

    return { score, recommendation };
}
