import { useState } from 'react';

const AGENTS = [
    { key: 'planner', name: 'Planner', icon: '📋', model: 'gemini', color: 'var(--agent-planner)' },
    { key: 'researcher', name: 'Research', icon: '🔍', model: 'claude', color: 'var(--agent-researcher)' },
    { key: 'asset', name: 'Asset', icon: '🎨', model: 'gemini', color: 'var(--agent-asset)' },
    { key: 'coder', name: 'Coder', icon: '💻', model: 'codex', color: 'var(--agent-coder)' },
    { key: 'tester', name: 'Tester', icon: '🧪', model: 'claude', color: 'var(--agent-tester)' },
    { key: 'critic', name: 'Critic', icon: '⚖️', model: 'claude', color: 'var(--agent-critic)' },
];

export default function PipelineView({ agentStates, logs, onAgentClick, customModels = {}, onModelChange, outputMode = 'website', modeProfiles = null, providerCatalogs = {} }) {
    const modeProfile = modeProfiles?.[outputMode] || null;

    return (
        <div className="pipeline-agents">
            {AGENTS.map((agent, i) => {
                const state = agentStates[agent.key] || 'idle';
                const provider = modeProfile?.providerMap?.[agent.key] || agent.model;
                const catalog = providerCatalogs?.[provider] || {};
                const recommendedModel = catalog.latestModel || catalog.defaultModel || '';
                const modelOptions = ['', ...new Set(catalog.models || [])];
                const defaultLabel = catalog.defaultLabel || 'default CLI model';
                const modelLabels = catalog.modelLabels || {};
                const selectedModel = Object.prototype.hasOwnProperty.call(customModels, agent.key)
                    ? customModels[agent.key]
                    : recommendedModel;
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
                            <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                {provider}
                            </div>
                            <div className="agent-model" style={{ marginTop: '8px' }}>
                                <select
                                    className="model-select"
                                    value={selectedModel}
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
                                    {modelOptions.map(m => (
                                        <option key={m || 'default'} value={m}>
                                            {m ? (modelLabels[m] || m) : defaultLabel}
                                        </option>
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
