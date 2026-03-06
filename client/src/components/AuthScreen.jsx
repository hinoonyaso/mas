import { useMemo, useState } from 'react';

const INITIAL_FORM = {
    login: {
        email: '',
        password: '',
    },
    register: {
        name: '',
        email: '',
        password: '',
    },
};

export default function AuthScreen({ mode, onModeChange, onSubmit, isSubmitting, error }) {
    const [formState, setFormState] = useState(INITIAL_FORM);

    const activeFields = useMemo(() => formState[mode], [formState, mode]);

    function updateField(field, value) {
        setFormState((prev) => ({
            ...prev,
            [mode]: {
                ...prev[mode],
                [field]: value,
            },
        }));
    }

    function handleSubmit(event) {
        event.preventDefault();
        onSubmit(activeFields);
    }

    return (
        <div className="auth-shell">
            <div className="auth-backdrop" />
            <div className="auth-grid">
                <section className="auth-hero">
                    <span className="auth-badge">Secure Access</span>
                    <h1>MAS Orchestration Workspace</h1>
                    <p>
                        연구 결과대로 자동 로그인 대신 명시적 인증 흐름을 적용했습니다.
                        계정을 생성하거나 로그인한 뒤 파이프라인, 로그, 평가 화면에 접근할 수 있습니다.
                    </p>
                    <div className="auth-hero-panel">
                        <div>JWT 세션 기반 인증</div>
                        <div>bcrypt 해시 저장</div>
                        <div>실시간 WebSocket 보호</div>
                    </div>
                </section>

                <section className="auth-card">
                    <div className="auth-card-header">
                        <div>
                            <div className="auth-eyebrow">Authentication</div>
                            <h2>{mode === 'login' ? '로그인' : '회원가입'}</h2>
                        </div>

                        <div className="auth-tabs" role="tablist" aria-label="Authentication Mode">
                            <button
                                type="button"
                                className={mode === 'login' ? 'active' : ''}
                                onClick={() => onModeChange('login')}
                            >
                                로그인
                            </button>
                            <button
                                type="button"
                                className={mode === 'register' ? 'active' : ''}
                                onClick={() => onModeChange('register')}
                            >
                                회원가입
                            </button>
                        </div>
                    </div>

                    <form className="auth-form" onSubmit={handleSubmit}>
                        {mode === 'register' && (
                            <label className="auth-field">
                                <span>이름</span>
                                <input
                                    type="text"
                                    value={activeFields.name}
                                    onChange={(event) => updateField('name', event.target.value)}
                                    placeholder="홍길동"
                                    autoComplete="name"
                                    maxLength={40}
                                    required
                                />
                            </label>
                        )}

                        <label className="auth-field">
                            <span>이메일</span>
                            <input
                                type="email"
                                value={activeFields.email}
                                onChange={(event) => updateField('email', event.target.value)}
                                placeholder="name@example.com"
                                autoComplete="email"
                                required
                            />
                        </label>

                        <label className="auth-field">
                            <span>비밀번호</span>
                            <input
                                type="password"
                                value={activeFields.password}
                                onChange={(event) => updateField('password', event.target.value)}
                                placeholder={mode === 'login' ? '비밀번호를 입력하세요' : '영문+숫자 8자 이상'}
                                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                required
                            />
                        </label>

                        {error && <div className="auth-error">{error}</div>}

                        <button type="submit" className="auth-submit" disabled={isSubmitting}>
                            {isSubmitting ? '처리 중...' : mode === 'login' ? '로그인' : '계정 만들기'}
                        </button>
                    </form>

                    <div className="auth-footer">
                        {mode === 'login' ? '계정이 없나요?' : '이미 계정이 있나요?'}
                        <button
                            type="button"
                            className="auth-switch"
                            onClick={() => onModeChange(mode === 'login' ? 'register' : 'login')}
                        >
                            {mode === 'login' ? '회원가입으로 이동' : '로그인으로 이동'}
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
