import bcrypt from 'bcrypt';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import config from '../config.js';

const SALT_ROUNDS = 12;
const USERS_FILE = path.resolve(process.cwd(), 'data', 'users.json');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function normalizeName(name) {
    return String(name || '').trim();
}

function sanitizeUser(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
}

async function ensureUsersFile() {
    await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });

    try {
        await fs.access(USERS_FILE);
    } catch {
        const passwordHash = await bcrypt.hash(config.auth.seedPassword, SALT_ROUNDS);
        const now = new Date().toISOString();
        const seedUser = {
            id: randomUUID(),
            email: normalizeEmail(config.auth.seedEmail),
            name: config.auth.seedName,
            role: 'admin',
            passwordHash,
            createdAt: now,
            updatedAt: now,
        };

        await fs.writeFile(USERS_FILE, JSON.stringify({ users: [seedUser] }, null, 2));
    }
}

async function readUsers() {
    await ensureUsersFile();
    const raw = await fs.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.users) ? parsed.users : [];
}

async function writeUsers(users) {
    await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2));
}

export function validateRegistrationInput({ email, password, name }) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = normalizeName(name);
    const normalizedPassword = String(password || '');

    if (!normalizedName || normalizedName.length < 2) {
        return { valid: false, error: '이름은 2자 이상 입력해 주세요.' };
    }

    if (normalizedName.length > 40) {
        return { valid: false, error: '이름은 40자 이하로 입력해 주세요.' };
    }

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
        return { valid: false, error: '올바른 이메일 형식을 입력해 주세요.' };
    }

    if (normalizedPassword.length < 8) {
        return { valid: false, error: '비밀번호는 8자 이상이어야 합니다.' };
    }

    const hasLetter = /[A-Za-z]/.test(normalizedPassword);
    const hasNumber = /\d/.test(normalizedPassword);
    if (!hasLetter || !hasNumber) {
        return { valid: false, error: '비밀번호는 영문과 숫자를 모두 포함해야 합니다.' };
    }

    return {
        valid: true,
        value: {
            email: normalizedEmail,
            name: normalizedName,
            password: normalizedPassword,
        },
    };
}

export async function initializeUserStore() {
    await ensureUsersFile();
}

export async function authenticateUser(email, password) {
    const normalizedEmail = normalizeEmail(email);
    const users = await readUsers();
    const user = users.find((entry) => entry.email === normalizedEmail);

    if (!user) {
        return null;
    }

    const passwordMatches = await bcrypt.compare(String(password || ''), user.passwordHash);
    if (!passwordMatches) {
        return null;
    }

    return sanitizeUser(user);
}

export async function findUserById(userId) {
    const users = await readUsers();
    const user = users.find((entry) => entry.id === userId);
    return user ? sanitizeUser(user) : null;
}

export async function createUser({ email, password, name, role = 'user' }) {
    const validation = validateRegistrationInput({ email, password, name });
    if (!validation.valid) {
        const error = new Error(validation.error);
        error.statusCode = 400;
        throw error;
    }

    const { email: normalizedEmail, password: normalizedPassword, name: normalizedName } = validation.value;
    const users = await readUsers();
    const existingUser = users.find((entry) => entry.email === normalizedEmail);

    if (existingUser) {
        const error = new Error('이미 사용 중인 이메일입니다.');
        error.statusCode = 409;
        throw error;
    }

    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash(normalizedPassword, SALT_ROUNDS);
    const user = {
        id: randomUUID(),
        email: normalizedEmail,
        name: normalizedName,
        role,
        passwordHash,
        createdAt: now,
        updatedAt: now,
    };

    // The store is file-based, so writes are centralized through one helper.
    users.push(user);
    await writeUsers(users);
    return sanitizeUser(user);
}
