import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const agentLLMMap = {
  planner: 'gemini',
  spec_builder: 'claude',
  researcher: 'claude',
  asset: 'gemini',
  coder: 'codex',
  patch_coder: 'codex',
  tester: 'claude',
  critic: 'claude',
};

const agentModelMap = {
  planner: '',
  spec_builder: '',
  researcher: '',
  asset: '',
  coder: '',
  patch_coder: '',
  tester: 'claude-sonnet-4-6',
  critic: 'claude-sonnet-4-6',
};

const outputModes = {
  website: {
    label: 'Website',
    description: 'Interactive web page or application output.',
    skipAsset: false,
    researchDepth: 'normal',
    promptFocus: 'UX flow, implementation feasibility, and polished interactive delivery.',
    contextPriority: 'Recent implementation details and visual references.',
    harnessFocus: 'Functional correctness, UX quality, and integration completeness.',
    providerMap: {
      ...agentLLMMap,
      planner: 'gemini',
      spec_builder: 'claude',
      researcher: 'claude',
      asset: 'gemini',
      coder: 'codex',
      patch_coder: 'codex',
      tester: 'claude',
      critic: 'claude',
    },
    modelMap: {
      ...agentModelMap,
      planner: 'gemini-2.5-flash',
      spec_builder: 'claude-sonnet-4-6',
      researcher: 'claude-sonnet-4-6',
      asset: 'gemini-2.5-pro',
      coder: 'gpt-5.4',
      patch_coder: 'gpt-5.4',
      tester: 'claude-sonnet-4-6',
      critic: 'claude-sonnet-4-6',
    },
  },
  docx: {
    label: 'Docx',
    description: 'Structured professional document output.',
    skipAsset: true,
    researchDepth: 'normal',
    promptFocus: 'Logical sectioning, readability, professional tone, and document completeness.',
    contextPriority: 'Outline fidelity, supporting facts, and section-to-section cohesion.',
    harnessFocus: 'Document completeness, structure, tone consistency, and factual coherence.',
    providerMap: {
      ...agentLLMMap,
      planner: 'gemini',
      spec_builder: 'claude',
      researcher: 'claude',
      coder: 'claude',
      patch_coder: 'claude',
      tester: 'claude',
      critic: 'claude',
    },
    modelMap: {
      ...agentModelMap,
      planner: 'gemini-2.5-flash',
      spec_builder: 'claude-sonnet-4-6',
      researcher: 'claude-sonnet-4-6',
      coder: 'claude-sonnet-4-6',
      patch_coder: 'claude-sonnet-4-6',
      tester: 'claude-sonnet-4-6',
      critic: 'claude-sonnet-4-6',
    },
  },
  sheet: {
    label: 'Sheet',
    description: 'Spreadsheet-style tabular output with summaries.',
    skipAsset: true,
    researchDepth: 'normal',
    promptFocus: 'Schema precision, data quality, formulas, and summary usefulness.',
    contextPriority: 'Column definitions, validation rules, and numeric integrity.',
    harnessFocus: 'Data accuracy, consistency, totals, and tabular usability.',
    providerMap: {
      ...agentLLMMap,
      planner: 'gemini',
      spec_builder: 'claude',
      researcher: 'claude',
      coder: 'codex',
      patch_coder: 'codex',
      tester: 'claude',
      critic: 'claude',
    },
    modelMap: {
      ...agentModelMap,
      planner: 'gemini-2.5-flash',
      spec_builder: 'claude-sonnet-4-6',
      researcher: 'claude-haiku-4-5',
      coder: 'gpt-5.4',
      patch_coder: 'gpt-5.4',
      tester: 'claude-sonnet-4-6',
      critic: 'claude-sonnet-4-6',
    },
  },
  slide: {
    label: 'Slide',
    description: 'Presentation slide deck with strong narrative and visuals.',
    skipAsset: false,
    researchDepth: 'normal',
    promptFocus: 'Narrative arc, one-message-per-slide discipline, and visual clarity.',
    contextPriority: 'Slide outline, visual direction, and audience attention flow.',
    harnessFocus: 'Message clarity, visual consistency, pacing, and audience engagement.',
    providerMap: {
      ...agentLLMMap,
      planner: 'gemini',
      spec_builder: 'claude',
      researcher: 'claude',
      asset: 'gemini',
      coder: 'codex',
      patch_coder: 'codex',
      tester: 'claude',
      critic: 'claude',
    },
    modelMap: {
      ...agentModelMap,
      planner: 'gemini-2.5-flash',
      spec_builder: 'claude-sonnet-4-6',
      researcher: 'claude-sonnet-4-6',
      asset: 'gemini-2.5-pro',
      coder: 'gpt-5.4',
      patch_coder: 'gpt-5.4',
      tester: 'claude-sonnet-4-6',
      critic: 'claude-sonnet-4-6',
    },
  },
  deep_research: {
    label: 'Deep Research',
    description: 'Long-form analytical report with balanced evidence and synthesis.',
    skipAsset: true,
    researchDepth: 'deep',
    promptFocus: 'Analytical rigor, competing viewpoints, evidence strength, and synthesis.',
    contextPriority: 'Longer research traces, opposing evidence, and uncertainty tracking.',
    harnessFocus: 'Depth, balance, fact-check quality, and argument strength.',
    providerMap: {
      ...agentLLMMap,
      planner: 'gemini',
      spec_builder: 'claude',
      researcher: 'claude',
      coder: 'claude',
      patch_coder: 'claude',
      tester: 'claude',
      critic: 'claude',
    },
    modelMap: {
      ...agentModelMap,
      planner: 'gemini-2.5-flash',
      spec_builder: 'claude-opus-4-6',
      researcher: 'claude-opus-4-6',
      coder: 'claude-sonnet-4-6',
      patch_coder: 'claude-sonnet-4-6',
      tester: 'claude-sonnet-4-6',
      critic: 'claude-opus-4-6',
    },
  },
};

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
  agentLLMMap,

  // Agent → 세부 AI 모델명 매핑 (기본값)
  // 빈 문자열은 각 CLI의 기본 모델을 사용합니다.
  // Gemini는 가용 모델명이 자주 바뀌므로 기본값을 강제하지 않습니다.
  agentModelMap,

  // 컨텍스트 설정
  context: {
    maxTokens: 8000,
    memoryDir: './data/memory',
  },

  qualityGate: {
    minScore: 8.5,
    maxRepairAttempts: 1,
  },

  ruleGate: {
    maxRepairAttempts: 1,
  },

  // 출력 모드 설정
  outputModes,
};
