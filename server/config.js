import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

export default {
  port: process.env.PORT || 3001,
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-only-jwt-secret-change-me',
    tokenTtl: process.env.JWT_TTL || '12h',
    seedEmail: process.env.AUTH_SEED_EMAIL || 'admin@mas.local',
    seedPassword: process.env.AUTH_SEED_PASSWORD || 'ChangeMe123!',
    seedName: process.env.AUTH_SEED_NAME || '관리자',
  },

  // Agent → CLI 매핑 (기본값)
  // gemini, claude, codex 중 설치된 CLI 사용
  agentLLMMap: {
    planner: 'gemini',
    researcher: 'claude',
    asset: 'gemini',
    coder: 'codex',
    tester: 'claude',
    critic: 'claude',
  },

  // Agent → 세부 AI 모델명 매핑 (기본값)
  // 빈 문자열은 각 CLI의 기본 모델을 사용합니다.
  // Gemini는 가용 모델명이 자주 바뀌므로 기본값을 강제하지 않습니다.
  agentModelMap: {
    planner: '',
    researcher: '',
    asset: '',
    coder: '',
    tester: 'sonnet',
    critic: '',
  },

  // 컨텍스트 설정
  context: {
    maxTokens: 8000,
    memoryDir: './data/memory',
  },
};
