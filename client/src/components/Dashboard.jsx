export default function Dashboard({ runHistory, wsConnected }) {
    const totalRuns = runHistory.length;
    const lastRun = runHistory[0] || null;

    return (
        <div>
            <div className="stats-row">
                <div className="stat-card">
                    <div className="stat-label">총 실행 횟수</div>
                    <div className="stat-value" style={{ color: 'var(--accent-indigo)' }}>{totalRuns}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">WebSocket</div>
                    <div className="stat-value" style={{ color: wsConnected ? 'var(--accent-emerald)' : 'var(--accent-rose)', fontSize: '16px' }}>
                        {wsConnected ? '🟢 연결됨' : '🔴 끊김'}
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">에이전트 수</div>
                    <div className="stat-value" style={{ color: 'var(--accent-cyan)' }}>6</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">LLM 방식</div>
                    <div className="stat-value" style={{ fontSize: '14px', color: 'var(--accent-emerald)' }}>CLI Subprocess</div>
                </div>
            </div>

            <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>📊</span> MAS vs Single Agent 성능 비교
                    <span style={{ fontSize: '12px', fontWeight: '400', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        (로그인 기능 구현 테스트 기준)
                    </span>
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: '16px', '@media (minWidth: 768px)': { gridTemplateColumns: 'repeat(3, 1fr)' } }}>
                    {/* Task Completion */}
                    <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Task Completion Rate</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '8px' }}>
                            <div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Single Agent</div>
                                <div style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>42%</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '11px', color: 'var(--accent-emerald)' }}>MAS</div>
                                <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--accent-emerald)' }}>73%</div>
                            </div>
                        </div>
                        <div style={{ height: '4px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
                            <div style={{ width: '42%', background: 'var(--text-secondary)' }} />
                            <div style={{ width: '31%', background: 'var(--accent-emerald)' }} />
                        </div>
                    </div>

                    {/* Fix Time */}
                    <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Average Fix Time</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '8px' }}>
                            <div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Single Agent</div>
                                <div style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>18 min</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '11px', color: 'var(--accent-cyan)' }}>MAS</div>
                                <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--accent-cyan)' }}>7 min</div>
                            </div>
                        </div>
                        <div style={{ height: '4px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
                            <div style={{ width: '38%', background: 'var(--accent-cyan)' }} />
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--accent-cyan)', marginTop: '8px', textAlign: 'right' }}>🔻 -61% 개선</div>
                    </div>

                    {/* Token Usage */}
                    <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Token Usage</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '8px' }}>
                            <div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Single Agent</div>
                                <div style={{ fontSize: '16px', color: 'var(--text-secondary)' }}>100%</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '11px', color: 'var(--accent-indigo)' }}>MAS</div>
                                <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--accent-indigo)' }}>62%</div>
                            </div>
                        </div>
                        <div style={{ height: '4px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
                            <div style={{ width: '62%', background: 'var(--accent-indigo)' }} />
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--accent-indigo)', marginTop: '8px', textAlign: 'right' }}>🔻 -38% 절감</div>
                    </div>
                </div>
            </div>

            <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>👀</span> 실제 구현 결과값 비교 (Demo)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Single Agent</span> (기능 누락, 디자인 부재)
                        </div>
                        <div style={{ border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', overflow: 'hidden', height: '400px', background: 'white' }}>
                            <iframe src="/demo-single.html" style={{ width: '100%', height: '100%', border: 'none' }} title="Single Agent Demo" />
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center' }}>
                            <span style={{ color: 'var(--accent-emerald)', fontWeight: '600' }}>MAS Orchestration</span> (완성형 UI, 검증 로직 포함)
                        </div>
                        <div style={{ border: '1px solid var(--accent-emerald)', borderRadius: '12px', overflow: 'hidden', height: '400px' }}>
                            <iframe src="/demo-mas.html" style={{ width: '100%', height: '100%', border: 'none' }} title="MAS Demo" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}>시스템 아키텍처</h3>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '1.8', color: 'var(--text-secondary)' }}>
                    <div>User Request</div>
                    <div style={{ color: 'var(--text-muted)' }}> ↓</div>
                    <div><span style={{ color: 'var(--agent-planner)' }}>● Planner</span> (gemini) → 태스크 분해</div>
                    <div style={{ color: 'var(--text-muted)' }}> ↓</div>
                    <div><span style={{ color: 'var(--agent-researcher)' }}>● Research</span> (claude) → 정보 수집</div>
                    <div style={{ color: 'var(--text-muted)' }}> ↓</div>
                    <div><span style={{ color: 'var(--agent-asset)' }}>● Asset Gener</span> (gemini) → 에셋 다운로드</div>
                    <div style={{ color: 'var(--text-muted)' }}> ↓</div>
                    <div><span style={{ color: 'var(--agent-coder)' }}>● Coder</span> (codex) → 구현</div>
                    <div style={{ color: 'var(--text-muted)' }}> ↓</div>
                    <div><span style={{ color: 'var(--agent-tester)' }}>● Tester</span> (gemini) → 검증</div>
                    <div style={{ color: 'var(--text-muted)' }}> ↓</div>
                    <div><span style={{ color: 'var(--agent-critic)' }}>● Critic</span> (claude) → 품질 평가</div>
                    <div style={{ color: 'var(--text-muted)' }}> ↓</div>
                    <div style={{ color: 'var(--accent-emerald)' }}>✓ Final Output</div>
                </div>
            </div>

            {lastRun && (
                <div className="glass-card" style={{ padding: '24px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}>최근 실행</h3>
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <div><strong>상태:</strong> {lastRun.status || 'completed'}</div>
                        <div><strong>시간:</strong> {lastRun.timestamp || 'N/A'}</div>
                        {lastRun.evaluation && <div><strong>평가:</strong> {lastRun.evaluation}</div>}
                        {lastRun.finalOutput && (
                            <div style={{ marginTop: '12px', whiteSpace: 'pre-wrap' }}>
                                <strong>최종 결과물:</strong>
                                <div style={{ marginTop: '8px', color: 'var(--text-muted)' }}>{lastRun.finalOutput}</div>
                            </div>
                        )}
                        {lastRun.previewPath && (
                            <div style={{ marginTop: '16px' }}>
                                <strong>렌더링 미리보기:</strong>
                                <div style={{ marginTop: '8px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
                                    <iframe
                                        src={lastRun.previewPath}
                                        title="Recent Run Preview"
                                        style={{ width: '100%', height: '480px', border: 'none' }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {totalRuns === 0 && (
                <div className="empty-state">
                    <div className="empty-icon">🚀</div>
                    <div className="empty-title">시작할 준비가 되었습니다</div>
                    <div className="empty-desc">
                        "실행" 탭에서 요청을 입력하면 5개 AI 에이전트가 순차적으로 협력하여 처리합니다.
                        <br /><br />
                        💡 토큰 최소화: CLI Subprocess 방식으로 추가 비용 없이 동작합니다.
                    </div>
                </div>
            )}
        </div>
    );
}
