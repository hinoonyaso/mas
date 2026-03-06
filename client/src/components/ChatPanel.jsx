import { useState, useRef, useEffect } from 'react';

export default function ChatPanel({ messages, onSend, isRunning }) {
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
                <div className="input-wrapper">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => { setInput(e.target.value); autoResize(e); }}
                        onKeyDown={handleKeyDown}
                        placeholder="요청을 입력하세요... (예: 로그인 시스템을 만들어줘)"
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
                            <>🚀 실행</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
