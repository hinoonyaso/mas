import { useState } from 'react';

const AGENT_COLORS = {
    planner: 'var(--agent-planner)',
    researcher: 'var(--agent-researcher)',
    asset: 'var(--agent-asset)',
    coder: 'var(--agent-coder)',
    tester: 'var(--agent-tester)',
    critic: 'var(--agent-critic)',
    rule_gate: 'var(--accent-amber)',
    repair_audit: 'var(--accent-cyan)',
};

export default function AgentLog({ log }) {
    const [expanded, setExpanded] = useState(false);
    const color = AGENT_COLORS[log.agent] || 'var(--text-secondary)';

    return (
        <div className="agent-log">
            <div className="agent-log-header">
                <div className="agent-log-title">
                    <span className="dot" style={{ background: color }} />
                    <span style={{ color }}>{log.agent?.toUpperCase()}</span>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '12px' }}>
                        — {log.role}
                    </span>
                    {log.success ? (
                        <span className="badge success">✓ 완료</span>
                    ) : (
                        <span className="badge error">✗ 실패</span>
                    )}
                </div>
                <div className="agent-log-metrics">
                    {log.metrics?.latency && <span>⏱ {(log.metrics.latency / 1000).toFixed(1)}s</span>}
                    {log.metrics?.totalTokens > 0 && <span>🔤 {log.metrics.totalTokens} tokens</span>}
                    {log.metrics?.provider && <span>🤖 {log.metrics.provider}</span>}
                </div>
            </div>
            <div className={`agent-log-body ${expanded ? 'expanded' : ''}`}>
                {log.output || log.error || 'No output'}
            </div>
            {(log.output?.length || 0) > 200 && (
                <button className="toggle-expand" onClick={() => setExpanded(!expanded)}>
                    {expanded ? '▲ 접기' : '▼ 더 보기'}
                </button>
            )}
        </div>
    );
}
