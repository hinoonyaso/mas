const API_BASE = '/api';
const WS_URL = `ws://${window.location.hostname}:3001`;
const AUTH_STORAGE_KEY = 'mas_auth_token';

export function getAuthToken() {
    return window.localStorage.getItem(AUTH_STORAGE_KEY) || '';
}

export function setAuthToken(token) {
    if (token) {
        window.localStorage.setItem(AUTH_STORAGE_KEY, token);
    } else {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
}

export function clearAuthToken() {
    setAuthToken('');
}

async function parseApiError(res) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    return new Error(err.error || 'API Error');
}

async function authRequest(path, credentials) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
    });

    if (!res.ok) {
        throw await parseApiError(res);
    }

    const data = await res.json();
    setAuthToken(data.token || '');
    return data;
}

export function login(credentials) {
    return authRequest('/auth/login', credentials);
}

export function register(credentials) {
    return authRequest('/auth/register', credentials);
}

export async function fetchCurrentUser(token = getAuthToken()) {
    if (!token) {
        throw new Error('인증 토큰이 없습니다.');
    }

    const res = await fetch(`${API_BASE}/auth/me`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        if (res.status === 401) {
            clearAuthToken();
        }
        throw await parseApiError(res);
    }

    const data = await res.json();
    return data.user;
}

export async function apiCall(endpoint, options = {}) {
    const token = getAuthToken();
    if (!token) {
        throw new Error('로그인이 필요합니다.');
    }

    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
    };

    const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (!res.ok) {
        if (res.status === 401) {
            clearAuthToken();
        }
        throw await parseApiError(res);
    }

    return res.json();
}

export function runPipeline(input, models = {}, outputMode = 'website') {
    return apiCall('/run', {
        method: 'POST',
        body: JSON.stringify({ input, models, outputMode }),
    });
}

export function getStatus() {
    return apiCall('/status');
}

export function getHistory() {
    return apiCall('/history');
}

export function getEvaluations() {
    return apiCall('/evaluations');
}

/**
 * WebSocket 연결
 */
export function createWebSocket(token, onMessage) {
    let ws;
    let reconnectTimer;
    let manuallyClosed = false;

    function connect() {
        if (manuallyClosed) return;
        ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);

        ws.onopen = () => {
            console.log('[WS] Connected');
            onMessage({ event: 'ws:connected' });
        };

        ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                onMessage(data);
            } catch {
                console.warn('[WS] Invalid message:', e.data);
            }
        };

        ws.onclose = () => {
            console.log('[WS] Disconnected, reconnecting in 3s...');
            onMessage({ event: 'ws:disconnected' });
            if (!manuallyClosed) {
                reconnectTimer = setTimeout(connect, 3000);
            }
        };

        ws.onerror = () => {
            ws.close();
        };
    }

    connect();

    return {
        close: () => {
            manuallyClosed = true;
            clearTimeout(reconnectTimer);
            ws?.close();
        },
    };
}
