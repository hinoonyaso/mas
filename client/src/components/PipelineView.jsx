import { useState } from 'react';

const AGENTS = [
    { key: 'planner', name: 'Planner', icon: '📋', model: 'gemini', color: 'var(--agent-planner)' },
    { key: 'researcher', name: 'Research', icon: '🔍', model: 'claude', color: 'var(--agent-researcher)' },
    { key: 'asset', name: 'Asset', icon: '🎨', model: 'gemini', color: 'var(--agent-asset)' },
    { key: 'coder', name: 'Coder', icon: '💻', model: 'codex', color: 'var(--agent-coder)' },
    { key: 'tester', name: 'Tester', icon: '🧪', model: 'claude', color: 'var(--agent-tester)' },
    { key: 'critic', name: 'Critic', icon: '⚖️', model: 'claude', color: 'var(--agent-critic)' },
];

const AGENT_MODELS = {
    gemini: ['', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    // 주의: claude CLI는 현재 OAuth 토큰 만료 상태일 수 있습니다.
    claude: ['', 'sonnet', 'opus', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    // 주의: ChatGPT 계정 등급에 따라 지원하는 모델이 다릅니다. 현재 확인된 구동 모델은 gpt-5.3-codex 입니다.
    codex: ['', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-4.5-preview', 'o3-mini', 'o1', 'gpt-4o', 'gpt-4o-mini']
};

export default function PipelineView({ agentStates, logs, onAgentClick, customModels = {}, onModelChange }) {
    return (
        <div className="pipeline-agents">
            {AGENTS.map((agent, i) => {
                const state = agentStates[agent.key] || 'idle';
                return (
                    <div key={agent.key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                            className={`agent-node ${state}`}
                            onClick={() => onAgentClick?.(agent.key)}
                            style={{ '--agent-color': agent.color }}
                        >
                            <div className="agent-icon" style={{ borderColor: agent.color }}>
                                {state === 'active' ? <div className="spinner" /> : agent.icon}
                            </div>
                            <div className="agent-name" style={{ color: state === 'completed' ? 'var(--accent-emerald)' : agent.color }}>
                                {agent.name}
                            </div>
                            <div className="agent-model" style={{ marginTop: '8px' }}>
                                <select
                                    className="model-select"
                                    value={customModels[agent.key] || AGENT_MODELS[agent.model][0]}
                                    onChange={(e) => onModelChange?.(agent.key, e.target.value)}
                                    disabled={state === 'active' || state === 'completed'}
                                    style={{
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        color: 'var(--text-secondary)',
                                        borderRadius: '4px',
                                        padding: '2px 4px',
                                        fontSize: '11px',
                                        width: '100%',
                                        outline: 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {AGENT_MODELS[agent.model].map(m => (
                                        <option key={m || 'default'} value={m}>{m || 'default CLI model'}</option>
                                    ))}
                                </select>
                            </div>
                            {state === 'completed' && <span style={{ fontSize: '10px', color: 'var(--accent-emerald)' }}>✓ Done</span>}
                            {state === 'error' && <span style={{ fontSize: '10px', color: 'var(--accent-rose)' }}>✗ Error</span>}
                        </div>
                        {i < AGENTS.length - 1 && (
                            <div className={`pipeline-arrow ${state === 'completed' ? 'completed' : state === 'active' ? 'active' : ''}`}>
                                →
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
