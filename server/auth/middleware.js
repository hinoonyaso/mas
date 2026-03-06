import jwt from 'jsonwebtoken';
import config from '../config.js';
import { findUserById } from './users.js';

function extractBearerToken(headerValue) {
    if (!headerValue || typeof headerValue !== 'string') {
        return null;
    }

    const [scheme, token] = headerValue.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return null;
    }

    return token;
}

export function signAuthToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
        },
        config.auth.jwtSecret,
        { expiresIn: config.auth.tokenTtl }
    );
}

export async function resolveUserFromToken(token) {
    if (!token) {
        return null;
    }

    try {
        const payload = jwt.verify(token, config.auth.jwtSecret);
        const user = await findUserById(payload.sub);
        return user || null;
    } catch {
        return null;
    }
}

export async function authenticateRequest(req, res, next) {
    const token = extractBearerToken(req.headers.authorization);
    const user = await resolveUserFromToken(token);

    if (!user) {
        return res.status(401).json({ error: '인증이 필요합니다.' });
    }

    req.user = user;
    req.authToken = token;
    next();
}
