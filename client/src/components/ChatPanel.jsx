import { useState, useRef, useEffect } from 'react';

const OUTPUT_MODES = [
    { key: 'website', label: 'Website', icon: '🌐', desc: '웹 페이지 생성' },
    { key: 'docx', label: 'Docx', icon: '📄', desc: '문서 생성' },
    { key: 'sheet', label: 'Sheet', icon: '📊', desc: '스프레드시트 생성' },
    { key: 'slide', label: 'Slide', icon: '📽️', desc: '프레젠테이션 생성' },
    { key: 'deep_research', label: 'Deep Research', icon: '🔬', desc: '심층 분석 리서치' },
];

export default function ChatPanel({ messages, onSend, isRunning, outputMode, onModeChange, modeProfile }) {
    const [input, setInput] = useState('');
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = () => {
        const text = input.trim();
        if (!text || isRunning) return;
        onSend(text);
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = '48px';
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const autoResize = (e) => {
        e.target.style.height = '48px';
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    };

    const currentMode = OUTPUT_MODES.find((m) => m.key === outputMode) || OUTPUT_MODES[0];

    return (
        <div className="chat-area">
            <div className="messages">
                {messages.length === 0 && (
                    <div className="empty-state">
                        <div className="empty-icon">🤖</div>
                        <div className="empty-title">자동 개발(MAS) 시작하기</div>
                        <div className="empty-desc">
                            원하는 앱, 기능, 디자인 요구사항을 입력하시면 6개의 전문 AI 에이전트가 협업하여 결과를 완성합니다.<br /><br />
                            <span style={{ color: 'var(--accent-indigo)', fontSize: '11px' }}>Planner → Research → Asset → Coder → Tester → Critic</span>
                        </div>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} className={`message ${msg.type}`}>
                        {msg.agent && <div className="msg-agent">{msg.agent}</div>}
                        <div className="msg-content">{msg.content}</div>
                    </div>
                ))}

                {isRunning && (
                    <div className="message system">
                        <div className="msg-agent">System</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className="spinner" />
                            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>에이전트 파이프라인 실행 중...</span>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <div className="input-area">
                {/* 출력 모드 선택 바 */}
                <div className="output-mode-bar">
                    {OUTPUT_MODES.map((mode) => (
                        <button
                            key={mode.key}
                            className={`mode-btn ${outputMode === mode.key ? 'active' : ''}`}
                            onClick={() => onModeChange(mode.key)}
                            disabled={isRunning}
                            title={mode.desc}
                        >
                            <span className="mode-icon">{mode.icon}</span>
                            <span className="mode-label">{mode.label}</span>
                        </button>
                    ))}
                </div>

                {modeProfile && (
                    <div className="mode-strategy-card">
                        <div className="mode-strategy-title">
                            {currentMode.icon} {modeProfile.label}
                        </div>
                        <div className="mode-strategy-desc">{modeProfile.description}</div>
                        <div className="mode-strategy-meta">
                            <span>LLM Focus: {modeProfile.promptFocus}</span>
                            <span>Context: {modeProfile.contextPriority}</span>
                            <span>Harness: {modeProfile.harnessFocus}</span>
                            <span>Research Depth: {modeProfile.researchDepth}</span>
                        </div>
                    </div>
                )}

                <div className="input-wrapper">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => { setInput(e.target.value); autoResize(e); }}
                        onKeyDown={handleKeyDown}
                        placeholder={currentMode.desc + '... (예: ' + _getPlaceholder(outputMode) + ')'}
                        rows={1}
                        disabled={isRunning}
                    />
                    <button
                        className="btn-send"
                        onClick={handleSend}
                        disabled={!input.trim() || isRunning}
                    >
                        {isRunning ? (
                            <><div className="spinner" /> 실행 중</>
                        ) : (
                            <>{currentMode.icon} 생성</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

function _getPlaceholder(mode) {
    const placeholders = {
        website: '로그인 페이지 만들어줘',
        docx: '프로젝트 기획안 작성해줘',
        sheet: '월별 매출 데이터 표 만들어줘',
        slide: 'AI 트렌드 프레젠테이션 만들어줘',
        deep_research: '인공지능의 미래에 대해 분석해줘',
    };
    return placeholders[mode] || placeholders.website;
}
