import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    clearAuthToken,
    createWebSocket,
    fetchCurrentUser,
    getAuthToken,
    getHistory,
    getStatus,
    login,
    register,
    runPipeline,
} from './api.js';
import ArtifactPanel from './components/ArtifactPanel.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import Dashboard from './components/Dashboard.jsx';
import EvalPanel from './components/EvalPanel.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import AgentLog from './components/AgentLog.jsx';
import PipelineView from './components/PipelineView.jsx';

const APP_LOGO = '/assets/logo.svg';

const TABS = [
    { key: 'run', label: '실행', icon: '🚀' },
    { key: 'dashboard', label: '대시보드', icon: '📊' },
    { key: 'eval', label: '평가', icon: '⚖️' },
];

const OUTPUT_MODE_LABELS = {
    website: 'WEBSITE',
    docx: 'DOCX',
    sheet: 'SHEET',
    slide: 'SLIDE',
    deep_research: 'DEEP RESEARCH',
};

export default function App() {
    const [tab, setTab] = useState('run');
    const [wsConnected, setWsConnected] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [messages, setMessages] = useState([]);
    const [agentStates, setAgentStates] = useState({});
    const [agentLogs, setAgentLogs] = useState([]);
    const [evaluation, setEvaluation] = useState(null);
    const [runHistory, setRunHistory] = useState([]);
    const [customModels, setCustomModels] = useState({});
    const [artifacts, setArtifacts] = useState([]);
    const [outputMode, setOutputMode] = useState('website');
    const [authMode, setAuthMode] = useState('login');
    const [authError, setAuthError] = useState('');
    const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [systemStatus, setSystemStatus] = useState(null);
    const wsRef = useRef(null);

    const isAuthenticated = Boolean(currentUser);
    const authToken = useMemo(() => getAuthToken(), [currentUser]);

    const closeSocket = useCallback(() => {
        wsRef.current?.close();
        wsRef.current = null;
        setWsConnected(false);
    }, []);

    const bindSocket = useCallback((token) => {
        closeSocket();

        const ws = createWebSocket(token, (data) => {
            switch (data.event) {
                case 'ws:connected':
                    setWsConnected(true);
                    break;
                case 'ws:disconnected':
                    setWsConnected(false);
                    break;
                case 'pipeline:start':
                    setIsRunning(true);
                    setAgentLogs([]);
                    setAgentStates({});
                    setEvaluation(null);
                    setArtifacts([]);
                    break;
                case 'agent:start':
                    setAgentStates((prev) => ({ ...prev, [data.data.agent]: 'active' }));
                    break;
                case 'agent:complete':
                    setAgentStates((prev) => ({
                        ...prev,
                        [data.data.agent]: data.data.success ? 'completed' : 'error',
                    }));
                    setAgentLogs((prev) => [
                        ...prev,
                        {
                            agent: data.data.agent,
                            role: data.data.role,
                            success: data.data.success,
                            output: data.data.output,
                            metrics: data.data.metrics,
                        },
                    ]);
                    break;
                case 'pipeline:complete':
                    setIsRunning(false);
                    setEvaluation(data.data.evaluation || null);
                    setArtifacts(data.data.artifacts || []);
                    setMessages((prev) => [
                        ...prev,
                        {
                            type: 'system',
                            agent: 'System',
                            content: `✅ 파이프라인 완료 (${(data.data.totalTime / 1000).toFixed(1)}s)\n\n${data.data.evaluation?.summary || ''}`,
                        },
                    ]);
                    break;
                case 'pipeline:error':
                    setIsRunning(false);
                    setMessages((prev) => [
                        ...prev,
                        {
                            type: 'system',
                            agent: 'System',
                            content: `❌ 오류 발생: ${data.data.error}`,
                        },
                    ]);
                    break;
            }
        });

        wsRef.current = ws;
    }, [closeSocket]);

    useEffect(() => {
        let cancelled = false;

        async function bootstrap() {
            const token = getAuthToken();
            if (!token) return;

            try {
                const user = await fetchCurrentUser(token);
                if (cancelled) return;
                setCurrentUser(user);
                bindSocket(token);
            } catch (error) {
                if (cancelled) return;
                clearAuthToken();
                setCurrentUser(null);
                setAuthError(error.message);
            }
        }

        bootstrap();
        return () => {
            cancelled = true;
            closeSocket();
        };
    }, [bindSocket, closeSocket]);

    useEffect(() => {
        if (!isAuthenticated) return;
        getHistory().then(setRunHistory).catch(() => { });
    }, [isAuthenticated, isRunning]);

    useEffect(() => {
        if (!isAuthenticated) return;
        getStatus().then(setSystemStatus).catch(() => { });
    }, [isAuthenticated]);

    const handleAuthSubmit = useCallback(async (payload) => {
        setIsAuthSubmitting(true);
        setAuthError('');

        try {
            const data = authMode === 'login'
                ? await login(payload)
                : await register(payload);

            setCurrentUser(data.user);
            bindSocket(data.token);
        } catch (error) {
            setAuthError(error.message);
        } finally {
            setIsAuthSubmitting(false);
        }
    }, [authMode, bindSocket]);

    const handleLogout = useCallback(() => {
        closeSocket();
        clearAuthToken();
        setCurrentUser(null);
        setMessages([]);
        setAgentLogs([]);
        setAgentStates({});
        setArtifacts([]);
        setEvaluation(null);
        setRunHistory([]);
        setCustomModels({});
        setSystemStatus(null);
        setAuthMode('login');
    }, [closeSocket]);

    const handleSend = useCallback(async (input) => {
        const label = OUTPUT_MODE_LABELS[outputMode] || outputMode.toUpperCase();
        setMessages((prev) => [...prev, { type: 'user', content: `[${label}] ${input}` }]);
        setTab('run');
        try {
            await runPipeline(input, customModels, outputMode);
        } catch (err) {
            setIsRunning(false);
            setMessages((prev) => [
                ...prev,
                { type: 'system', agent: 'Error', content: `요청 실패: ${err.message}` },
            ]);
        }
    }, [customModels, outputMode]);

    if (!isAuthenticated) {
        return (
            <AuthScreen
                mode={authMode}
                onModeChange={setAuthMode}
                onSubmit={handleAuthSubmit}
                isSubmitting={isAuthSubmitting}
                error={authError}
            />
        );
    }

    return (
        <div className="app-layout">
            <aside className="sidebar">
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <img className="logo-icon" src={APP_LOGO} alt="MAS logo" />
                        <div>
                            <h1>MAS</h1>
                            <div className="subtitle">Multi-Agent Orchestration</div>
                        </div>
                    </div>
                </div>

                <nav className="sidebar-nav">
                    {TABS.map((t) => (
                        <div
                            key={t.key}
                            className={`nav-item ${tab === t.key ? 'active' : ''}`}
                            onClick={() => setTab(t.key)}
                        >
                            <span className="nav-icon">{t.icon}</span>
                            {t.label}
                        </div>
                    ))}
                </nav>

                <div className="sidebar-status">
                    <div className="status-badge">
                        <div className={`status-dot`} style={{ background: wsConnected ? 'var(--accent-emerald)' : 'var(--accent-rose)' }} />
                        {wsConnected ? 'Server Connected' : 'Disconnected'}
                    </div>
                    <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {currentUser.email}
                    </div>
                    <button
                        type="button"
                        onClick={handleLogout}
                        style={{
                            marginTop: '12px',
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: '10px',
                            border: '1px solid rgba(255,255,255,0.12)',
                            background: 'rgba(255,255,255,0.04)',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                        }}
                    >
                        로그아웃
                    </button>
                </div>
            </aside>

            <main className="main-content">
                <div className="main-header">
                    <h2>
                        {tab === 'run' && '🚀 파이프라인 실행'}
                        {tab === 'dashboard' && '📊 대시보드'}
                        {tab === 'eval' && '⚖️ 평가 결과'}
                    </h2>
                    {isRunning && <div className="loading-bar" style={{ width: '120px' }} />}
                </div>

                <div className="main-body">
                    {tab === 'run' && (
                        <div className="pipeline-container">
                            <PipelineView
                                agentStates={agentStates}
                                outputMode={outputMode}
                                modeProfiles={systemStatus?.modeProfiles || null}
                                customModels={customModels}
                                onModelChange={(agentKey, model) => setCustomModels((prev) => ({ ...prev, [agentKey]: model }))}
                            />

                            <ArtifactPanel artifacts={artifacts} outputMode={outputMode} />

                            {agentLogs.length > 0 && (
                                <div>
                                    <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                                        에이전트 실행 로그
                                    </h3>
                                    {agentLogs.map((log, i) => (
                                        <AgentLog key={i} log={log} />
                                    ))}
                                </div>
                            )}

                            <ChatPanel
                                messages={messages}
                                onSend={handleSend}
                                isRunning={isRunning}
                                outputMode={outputMode}
                                onModeChange={setOutputMode}
                                modeProfile={systemStatus?.modeProfiles?.[outputMode] || null}
                            />
                        </div>
                    )}

                    {tab === 'dashboard' && (
                        <Dashboard runHistory={runHistory} wsConnected={wsConnected} />
                    )}

                    {tab === 'eval' && (
                        <EvalPanel evaluation={evaluation} />
                    )}
                </div>
            </main>
        </div>
    );
}
