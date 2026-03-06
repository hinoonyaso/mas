import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config.js';
import Pipeline from './orchestrator/pipeline.js';
import { authenticateUser, createUser, initializeUserStore, validateRegistrationInput } from './auth/users.js';
import { authenticateRequest, resolveUserFromToken, signAuthToken } from './auth/middleware.js';
import { clearLoginFailures, loginRateLimit, recordLoginFailure } from './auth/rate-limit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

// WebSocket 클라이언트 관리
const clients = new Set();

function parseWebSocketToken(request) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    return url.searchParams.get('token');
}

wss.on('connection', async (ws, request) => {
    const token = parseWebSocketToken(request);
    const user = await resolveUserFromToken(token);

    if (!user) {
        ws.close(4401, 'Unauthorized');
        return;
    }

    ws.user = user;
    clients.add(ws);
    console.log(`[WS] Client connected: ${user.email} (total: ${clients.size})`);

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`[WS] Client disconnected (total: ${clients.size})`);
    });
});

function broadcast(message) {
    for (const client of clients) {
        if (client.readyState === 1) {
            client.send(message);
        }
    }
}

// Pipeline 인스턴스
const pipeline = new Pipeline(broadcast);

// ─── REST API ────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'login.html'));
});

app.post('/api/auth/login', loginRateLimit, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
        return res.status(400).json({ error: '이메일과 비밀번호를 모두 입력해 주세요.' });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
        return res.status(400).json({ error: '올바른 이메일 형식을 입력해 주세요.' });
    }

    try {
        const user = await authenticateUser(email, password);

        if (!user) {
            recordLoginFailure(req);
            return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
        }

        clearLoginFailures(req);

        res.json({
            token: signAuthToken(user),
            user,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/register', async (req, res) => {
    const validation = validateRegistrationInput(req.body || {});
    if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
    }

    try {
        const user = await createUser(validation.value);
        res.status(201).json({
            token: signAuthToken(user),
            user,
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : '회원가입 처리 중 오류가 발생했습니다.',
        });
    }
});

app.get('/api/auth/me', authenticateRequest, (req, res) => {
    res.json({ user: req.user });
});

// 시스템 상태
app.get('/api/status', authenticateRequest, (req, res) => {
    res.json(pipeline.getStatus());
});

// 파이프라인 실행
app.post('/api/run', authenticateRequest, async (req, res) => {
    const { input, models, outputMode } = req.body;

    if (!input || typeof input !== 'string') {
        return res.status(400).json({ error: 'input is required' });
    }

    const validModes = ['website', 'docx', 'sheet', 'slide', 'deep_research'];
    const mode = validModes.includes(outputMode) ? outputMode : 'website';

    try {
        const result = await pipeline.run(input, models || {}, mode);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 실행 이력
app.get('/api/history', authenticateRequest, (req, res) => {
    res.json(pipeline.getHistory());
});

// 평가 이력
app.get('/api/evaluations', authenticateRequest, (req, res) => {
    res.json(pipeline.getEvaluations());
});

// ─── 서버 시작 ────────────────────────────────────────

await initializeUserStore();

server.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║     🤖 MAS Orchestration Server                  ║
║     Port: ${config.port}                                ║
║     WebSocket: ws://localhost:${config.port}             ║
╚══════════════════════════════════════════════════╝

Available LLM Providers: ${pipeline.getStatus().availableProviders.join(', ') || 'demo mode'}
Auth Seed User:
  Email      → ${config.auth.seedEmail}
  Password   → ${config.auth.seedPassword}
Agent Configuration:
  Planner    → ${config.agentLLMMap.planner}
  Researcher → ${config.agentLLMMap.researcher}
  Coder      → ${config.agentLLMMap.coder}
  Tester     → ${config.agentLLMMap.tester}
  Critic     → ${config.agentLLMMap.critic}
  `);
});
