export default function EvalPanel({ evaluation }) {
    if (!evaluation) {
        return (
            <div className="empty-state">
                <div className="empty-icon">📊</div>
                <div className="empty-title">평가 데이터 없음</div>
                <div className="empty-desc">파이프라인을 실행하면 여기에 성능 평가 결과가 표시됩니다.</div>
            </div>
        );
    }

    const { pipelineMetrics, quality } = evaluation;

    return (
        <div>
            <div className="eval-grid">
                <div className="eval-card">
                    <div className="eval-value">{quality?.score || 0}/10</div>
                    <div className="eval-label">품질 점수</div>
                </div>
                <div className="eval-card">
                    <div className="eval-value" style={{ fontSize: '20px' }}>
                        {quality?.recommendation || 'N/A'}
                    </div>
                    <div className="eval-label">추천</div>
                </div>
                <div className="eval-card">
                    <div className="eval-value">{pipelineMetrics?.successRate?.toFixed(0) || 0}%</div>
                    <div className="eval-label">성공률</div>
                </div>
                <div className="eval-card">
                    <div className="eval-value">{((pipelineMetrics?.totalLatency || 0) / 1000).toFixed(1)}s</div>
                    <div className="eval-label">총 지연시간</div>
                </div>
                <div className="eval-card">
                    <div className="eval-value">{pipelineMetrics?.totalTokens || 0}</div>
                    <div className="eval-label">총 토큰</div>
                </div>
                <div className="eval-card">
                    <div className="eval-value">${pipelineMetrics?.estimatedCost || 0}</div>
                    <div className="eval-label">추정 비용</div>
                </div>
            </div>

            {pipelineMetrics?.agents && (
                <div className="glass-card" style={{ padding: '20px' }}>
                    <h3 style={{ fontSize: '14px', marginBottom: '16px', fontWeight: '600' }}>에이전트별 성능</h3>
                    <table className="eval-agents-table">
                        <thead>
                            <tr>
                                <th>에이전트</th>
                                <th>Provider</th>
                                <th>지연시간</th>
                                <th>토큰</th>
                                <th>상태</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(pipelineMetrics.agents).map(([name, m]) => (
                                <tr key={name}>
                                    <td style={{ fontWeight: 600 }}>{name}</td>
                                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{m.provider}</td>
                                    <td>{(m.latency / 1000).toFixed(1)}s</td>
                                    <td>{m.totalTokens}</td>
                                    <td>
                                        <span className={`badge ${m.success ? 'success' : 'error'}`}>
                                            {m.success ? '✓' : '✗'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
