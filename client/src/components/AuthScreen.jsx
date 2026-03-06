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

const HERO_IMAGE = '/assets/login_hero_illustration.png';
const HERO_IMAGE_FALLBACK = '/assets/login_page_background.png';

function validateForm(mode, fields) {
    const email = String(fields.email || '').trim();
    const password = String(fields.password || '');
    const name = String(fields.name || '').trim();

    if (mode === 'register') {
        if (name.length < 2) {
            return '이름은 2자 이상 입력해 주세요.';
        }

        if (name.length > 40) {
            return '이름은 40자 이하로 입력해 주세요.';
        }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return '올바른 이메일 형식을 입력해 주세요.';
    }

    if (!password) {
        return '비밀번호를 입력해 주세요.';
    }

    // Mirror server-side registration rules so users see failures before submit.
    if (mode === 'register') {
        if (password.length < 8) {
            return '비밀번호는 8자 이상이어야 합니다.';
        }

        if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
            return '비밀번호는 영문과 숫자를 모두 포함해야 합니다.';
        }
    }

    return '';
}

export default function AuthScreen({ mode, onModeChange, onSubmit, isSubmitting, error }) {
    const [formState, setFormState] = useState(INITIAL_FORM);
    const [localError, setLocalError] = useState('');
    const [heroImageSrc, setHeroImageSrc] = useState(HERO_IMAGE);
    const [passwordVisible, setPasswordVisible] = useState({
        login: false,
        register: false,
    });

    const activeFields = useMemo(() => formState[mode], [formState, mode]);
    // Keep client-side validation feedback ahead of server responses for faster correction.
    const formError = localError || error;

    function updateField(field, value) {
        setFormState((prev) => ({
            ...prev,
            [mode]: {
                ...prev[mode],
                [field]: value,
            },
        }));
        setLocalError('');
    }

    function switchMode(nextMode) {
        setLocalError('');
        onModeChange(nextMode);
    }

    function togglePasswordVisibility(targetMode) {
        setPasswordVisible((prev) => ({
            ...prev,
            [targetMode]: !prev[targetMode],
        }));
    }

    function handleSubmit(event) {
        event.preventDefault();
        const validationError = validateForm(mode, activeFields);
        if (validationError) {
            setLocalError(validationError);
            return;
        }

        const payload = {
            ...activeFields,
            email: activeFields.email.trim(),
            ...(mode === 'register' ? { name: activeFields.name.trim() } : {}),
        };

        onSubmit(payload);
    }

    return (
        <div className="auth-shell">
            <div className="auth-backdrop" />
            <div className="auth-grid">
                <section className="auth-hero">
                    <div className="auth-brand">
                        <img src="/assets/logo.svg" alt="MAS" className="auth-brand-logo" />
                        <div>
                            <strong>MAS Workspace</strong>
                            <span>Multi-Agent Orchestration</span>
                        </div>
                    </div>
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
                    <div className="auth-hero-notes" aria-label="보안 정책">
                        <div className="auth-note">
                            <strong>보안 정책</strong>
                            <span>로그인 실패 5회 초과 시 10분 동안 요청이 제한됩니다.</span>
                        </div>
                        <div className="auth-note">
                            <strong>가입 규칙</strong>
                            <span>이름 2자 이상, 비밀번호는 영문과 숫자를 포함한 8자 이상입니다.</span>
                        </div>
                    </div>
                    <div className="auth-hero-visual" aria-hidden="true">
                        <div className="auth-orbit auth-orbit-one" />
                        <div className="auth-orbit auth-orbit-two" />
                        <img
                            src={heroImageSrc}
                            alt=""
                            className="auth-hero-image"
                            onError={() => {
                                if (heroImageSrc !== HERO_IMAGE_FALLBACK) {
                                    setHeroImageSrc(HERO_IMAGE_FALLBACK);
                                }
                            }}
                        />
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
                                onClick={() => switchMode('login')}
                            >
                                로그인
                            </button>
                            <button
                                type="button"
                                className={mode === 'register' ? 'active' : ''}
                                onClick={() => switchMode('register')}
                            >
                                회원가입
                            </button>
                        </div>
                    </div>

                    <div className="auth-card-copy">
                        {mode === 'login'
                            ? '기존 워크스페이스 계정으로 로그인하고 파이프라인 실행 내역과 실시간 로그를 확인하세요.'
                            : '새 계정을 만들고 보안이 적용된 멀티 에이전트 워크스페이스를 바로 시작하세요.'}
                    </div>

                    <div className="auth-inline-tip">
                        {mode === 'login'
                            ? '관리자 시드 계정은 서버 설정의 AUTH_SEED_EMAIL / AUTH_SEED_PASSWORD 값을 사용합니다.'
                            : '회원가입 직후 바로 로그인 상태로 전환되며 WebSocket 연결도 자동으로 초기화됩니다.'}
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
                                    minLength={2}
                                    maxLength={40}
                                    aria-invalid={Boolean(formError)}
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
                                inputMode="email"
                                aria-invalid={Boolean(formError)}
                                required
                            />
                        </label>

                        <label className="auth-field">
                            <span>비밀번호</span>
                            <div className="auth-password-field">
                                <input
                                    type={passwordVisible[mode] ? 'text' : 'password'}
                                    value={activeFields.password}
                                    onChange={(event) => updateField('password', event.target.value)}
                                    placeholder={mode === 'login' ? '비밀번호를 입력하세요' : '영문+숫자 8자 이상'}
                                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                    minLength={mode === 'register' ? 8 : undefined}
                                    aria-invalid={Boolean(formError)}
                                    required
                                />
                                <button
                                    type="button"
                                    className="auth-password-toggle"
                                    onClick={() => togglePasswordVisibility(mode)}
                                    aria-label={passwordVisible[mode] ? '비밀번호 숨기기' : '비밀번호 표시'}
                                    aria-pressed={passwordVisible[mode]}
                                >
                                    {passwordVisible[mode] ? '숨기기' : '표시'}
                                </button>
                            </div>
                            {mode === 'register' && (
                                <small>영문과 숫자를 모두 포함한 8자 이상 비밀번호를 사용합니다.</small>
                            )}
                        </label>

                        {formError && (
                            <div className="auth-error" role="alert">
                                {formError}
                            </div>
                        )}

                        <button type="submit" className="auth-submit" disabled={isSubmitting}>
                            {isSubmitting ? '처리 중...' : mode === 'login' ? '로그인' : '계정 만들기'}
                        </button>
                    </form>

                    <div className="auth-footer">
                        {mode === 'login' ? '계정이 없나요?' : '이미 계정이 있나요?'}
                        <button
                            type="button"
                            className="auth-switch"
                            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                        >
                            {mode === 'login' ? '회원가입으로 이동' : '로그인으로 이동'}
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
