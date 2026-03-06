const attempts = new Map();

function buildKey(req) {
    return `${req.ip}:${String(req.body?.email || '').trim().toLowerCase()}`;
}

export function loginRateLimit(req, res, next) {
    const key = buildKey(req);
    const now = Date.now();
    const maxAttempts = 5;
    const windowMs = 10 * 60 * 1000;
    const entry = attempts.get(key);

    if (!entry || now > entry.resetAt) {
        attempts.set(key, { count: 0, resetAt: now + windowMs });
        return next();
    }

    if (entry.count >= maxAttempts) {
        const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
        res.setHeader('Retry-After', String(retryAfterSeconds));
        return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }

    next();
}

export function recordLoginFailure(req) {
    const key = buildKey(req);
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const entry = attempts.get(key);

    if (!entry || now > entry.resetAt) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return;
    }

    entry.count += 1;
}

export function clearLoginFailures(req) {
    attempts.delete(buildKey(req));
}
