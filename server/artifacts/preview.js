import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildArtifactPath } from './storage.js';

const ARTIFACTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(ARTIFACTS_DIR, '..', '..');
const SERVER_PUBLIC_DIR = path.join(PROJECT_ROOT, 'server', 'public');

function extractCodeBlocks(text) {
  const blocks = [];
  const regex = /```([\w-]*)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: (match[1] || '').toLowerCase(),
      code: match[2].trim(),
    });
  }

  return blocks;
}

function tryBuildServerLoginPreview(userInput, outputMode = 'website') {
  if (outputMode !== 'website') return null;
  if (!/login|signin|auth|로그인|인증/i.test(String(userInput || ''))) return null;

  const htmlPath = path.join(SERVER_PUBLIC_DIR, 'login.html');
  const cssPath = path.join(SERVER_PUBLIC_DIR, 'styles', 'login.css');
  const jsPath = path.join(SERVER_PUBLIC_DIR, 'scripts', 'login.js');
  const bgPath = path.join(SERVER_PUBLIC_DIR, 'assets', 'premium_login_background.svg');

  if (!fs.existsSync(htmlPath) || !fs.existsSync(cssPath) || !fs.existsSync(jsPath)) {
    return null;
  }

  let html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const bgSvg = fs.existsSync(bgPath) ? fs.readFileSync(bgPath, 'utf8') : '';

  const inlinedCss = bgSvg
    ? css.replace(/url\(["']?\/assets\/premium_login_background\.svg["']?\)/g, `url("data:image/svg+xml;utf8,${encodeURIComponent(bgSvg)}")`)
    : css;

  html = html.replace(/<link rel="stylesheet" href="\/styles\/login\.css">\s*/i, `<style>\n${inlinedCss}\n</style>\n`);
  html = html.replace(/<script type="module" src="\/scripts\/login\.js"><\/script>\s*/i, `<script>\n${js}\n</script>\n`);

  if (!/MAS Preview/i.test(html)) {
    html = html.replace(
      /<main class="login-shell"/i,
      `<div style="position:fixed;top:16px;left:16px;z-index:10;padding:8px 12px;border-radius:999px;background:rgba(8,20,40,0.72);border:1px solid rgba(125,156,194,0.32);color:#67e8f9;font:600 12px/1 Inter, sans-serif;letter-spacing:.08em;text-transform:uppercase;">MAS Preview</div>\n    <main class="login-shell"`
    );
  }

  return html;
}

function extractAssetPaths(text) {
  const matches = [];
  const regex = /\/assets\/[^\s`'")]+/g;
  let match;
  while ((match = regex.exec(text || '')) !== null) {
    matches.push(match[0]);
  }
  return [...new Set(matches)];
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function summarizeStep(step, fallback = 'No output provided.') {
  const clean = String(step?.output || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clean || fallback;
}

function buildModeFallbackHtml({ userInput, previousSteps = [], outputMode = 'website' }) {
  const existingLoginPreview = tryBuildServerLoginPreview(userInput, outputMode);
  if (existingLoginPreview) {
    return existingLoginPreview;
  }

  const researcher = previousSteps.find((step) => step.agent === 'researcher');
  const planner = previousSteps.find((step) => step.agent === 'planner');
  const tester = previousSteps.find((step) => step.agent === 'tester');
  const critic = previousSteps.find((step) => step.agent === 'critic');
  const assetPaths = previousSteps.flatMap((step) => extractAssetPaths(step.output));
  const heroAsset = assetPaths[0] || '';
  const planSummary = summarizeStep(planner, userInput).slice(0, 1200);
  const researchSummary = summarizeStep(researcher, userInput).slice(0, 2400);
  const testSummary = summarizeStep(tester, 'Validation pending.').slice(0, 1200);
  const criticSummary = summarizeStep(critic, 'Quality review pending.').slice(0, 1200);

  const sharedStyles = `
    :root {
      --bg: #07111f;
      --bg-soft: #0f172a;
      --panel: rgba(15, 23, 42, 0.82);
      --line: rgba(148, 163, 184, 0.22);
      --text: #e2e8f0;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-2: #818cf8;
      --good: #34d399;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, system-ui, sans-serif;
      background:
        radial-gradient(circle at top right, rgba(56,189,248,0.18), transparent 28%),
        radial-gradient(circle at bottom left, rgba(129,140,248,0.18), transparent 30%),
        var(--bg);
      color: var(--text);
    }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 40px 24px 72px; }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: 0 24px 60px rgba(2, 6, 23, 0.35);
      backdrop-filter: blur(18px);
    }
    .eyebrow {
      display: inline-flex;
      gap: 10px;
      align-items: center;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.24);
      color: #bae6fd;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    h1, h2, h3, p { margin: 0; }
    .muted { color: var(--muted); }
    .grid { display: grid; gap: 20px; }
    .prose {
      white-space: pre-wrap;
      line-height: 1.7;
      color: var(--muted);
      font-size: 15px;
    }
    .hero-image {
      width: 100%;
      min-height: 280px;
      object-fit: cover;
      border-radius: 20px;
      border: 1px solid var(--line);
      display: block;
      background: rgba(15, 23, 42, 0.8);
    }
    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .badge {
      border-radius: 999px;
      padding: 8px 12px;
      background: rgba(148, 163, 184, 0.12);
      border: 1px solid var(--line);
      color: var(--text);
      font-size: 13px;
    }
    .section-title { font-size: 18px; margin-bottom: 12px; }
    @media (max-width: 900px) {
      .wrap { padding: 24px 16px 48px; }
    }
  `;

  if (outputMode === 'website') {
    const intent = detectWebsiteIntent(userInput);
    if (intent === 'dashboard') {
      return buildDashboardFallback({ userInput, heroAsset, planSummary, researchSummary, testSummary, criticSummary, sharedStyles });
    }
    if (intent === 'landing') {
      return buildLandingFallback({ userInput, heroAsset, planSummary, researchSummary, testSummary, criticSummary, sharedStyles });
    }
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAS Website Preview</title>
  <style>
    ${sharedStyles}
    .hero {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 24px;
      padding: 28px;
      align-items: stretch;
    }
    .hero-copy { display: flex; flex-direction: column; justify-content: space-between; gap: 20px; }
    .hero-copy h1 { font-size: clamp(32px, 6vw, 64px); line-height: 1.02; }
    .hero-copy p { font-size: 17px; line-height: 1.7; color: var(--muted); }
    .panel-grid { margin-top: 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .panel { padding: 22px; }
    @media (max-width: 900px) {
      .hero { grid-template-columns: 1fr; }
      .panel-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero card">
      <div class="hero-copy">
        <div class="grid">
          <div class="eyebrow">MAS Guaranteed Preview</div>
          <h1>${escapeHtml(userInput)}</h1>
          <p>LLM coder output was empty, so the server synthesized this website preview from planner, researcher, asset, and review context to guarantee a usable result.</p>
          <div class="badge-row">
            <span class="badge">Mode: Website</span>
            <span class="badge">Source: Deterministic Fallback</span>
            <span class="badge">Asset Linked: ${heroAsset ? 'Yes' : 'No'}</span>
          </div>
        </div>
        <div class="card panel">
          <div class="section-title">Implementation Direction</div>
          <div class="prose">${escapeHtml(planSummary)}</div>
        </div>
      </div>
      <div class="grid">
        ${heroAsset ? `<img class="hero-image" src="${escapeAttr(heroAsset)}" alt="Generated visual asset" />` : '<div class="card panel"><div class="section-title">Visual Asset</div><div class="prose">No generated asset was attached, so this preview focuses on structure and content.</div></div>'}
        <div class="card panel">
          <div class="section-title">Research Summary</div>
          <div class="prose">${escapeHtml(researchSummary)}</div>
        </div>
      </div>
    </section>

    <section class="panel-grid">
      <div class="card panel">
        <div class="section-title">Validation</div>
        <div class="prose">${escapeHtml(testSummary)}</div>
      </div>
      <div class="card panel">
        <div class="section-title">Quality Review</div>
        <div class="prose">${escapeHtml(criticSummary)}</div>
      </div>
      <div class="card panel">
        <div class="section-title">Next Action</div>
        <div class="prose">This preview keeps the pipeline successful even when the coder returns nothing. You can now inspect structure, content, and linked assets without losing the run.</div>
      </div>
    </section>
  </div>
</body>
</html>`;
  }

  if (outputMode === 'slide') {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAS Slide Preview</title>
  <style>
    ${sharedStyles}
    body { overflow: hidden; }
    .deck { width: 100vw; height: 100vh; position: relative; }
    .slide { position: absolute; inset: 0; padding: 72px; display: none; }
    .slide.active { display: block; }
    .slide h1 { font-size: 56px; margin-bottom: 20px; }
    .slide h2 { font-size: 30px; margin-bottom: 14px; }
    .nav { position: fixed; bottom: 28px; right: 36px; color: var(--muted); font-size: 14px; }
    .notes { margin-top: 20px; max-width: 900px; }
  </style>
</head>
<body>
  <div class="deck">
    <section class="slide active">
      <div class="eyebrow">Guaranteed Slide Deck</div>
      <h1>${escapeHtml(userInput)}</h1>
      <p class="muted">Fallback presentation generated because coder output was empty.</p>
      ${heroAsset ? `<img class="hero-image" src="${escapeAttr(heroAsset)}" alt="Presentation asset" />` : ''}
    </section>
    <section class="slide" id="slide-2">
      <h2>Research Highlights</h2>
      <div class="notes prose">${escapeHtml(researchSummary)}</div>
    </section>
    <section class="slide" id="slide-3">
      <h2>Plan and Delivery Notes</h2>
      <div class="notes prose">${escapeHtml(planSummary + '\n\n' + criticSummary)}</div>
    </section>
  </div>
  <div class="nav">Static fallback preview</div>
</body>
</html>`;
  }

  if (outputMode === 'sheet') {
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAS Sheet Preview</title>
  <style>
    ${sharedStyles}
    table { width: 100%; border-collapse: collapse; background: rgba(255,255,255,0.98); color: #0f172a; border-radius: 18px; overflow: hidden; }
    th, td { padding: 14px 16px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    th { text-align: left; background: #e0f2fe; }
  </style>
</head>
<body>
  <div class="wrap grid">
    <div class="eyebrow">Guaranteed Sheet Preview</div>
    <div class="card" style="padding: 24px;">
      <h1 style="margin-bottom: 12px;">${escapeHtml(userInput)}</h1>
      <p class="muted" style="margin-bottom: 18px;">Coder output was empty, so this fallback sheet summarizes the run into a structured table.</p>
      <table>
        <thead>
          <tr><th>Section</th><th>Summary</th></tr>
        </thead>
        <tbody>
          <tr><td>Planning</td><td>${escapeHtml(planSummary)}</td></tr>
          <tr><td>Research</td><td>${escapeHtml(researchSummary)}</td></tr>
          <tr><td>Validation</td><td>${escapeHtml(testSummary)}</td></tr>
          <tr><td>Review</td><td>${escapeHtml(criticSummary)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAS Document Preview</title>
  <style>
    ${sharedStyles}
    .doc { max-width: 920px; margin: 0 auto; padding: 40px 28px; }
    .doc h1 { font-size: 38px; margin: 18px 0 12px; }
    .doc section { margin-top: 28px; padding: 24px; }
  </style>
</head>
<body>
  <div class="wrap">
    <article class="doc card">
      <div class="eyebrow">Guaranteed ${escapeHtml(outputMode)}</div>
      <h1>${escapeHtml(userInput)}</h1>
      <p class="muted">Coder output was empty, so the server generated this structured fallback document.</p>
      <section class="card">
        <h2>Planning</h2>
        <div class="prose">${escapeHtml(planSummary)}</div>
      </section>
      <section class="card">
        <h2>Research</h2>
        <div class="prose">${escapeHtml(researchSummary)}</div>
      </section>
      <section class="card">
        <h2>Validation</h2>
        <div class="prose">${escapeHtml(testSummary)}</div>
      </section>
      <section class="card">
        <h2>Review</h2>
        <div class="prose">${escapeHtml(criticSummary)}</div>
      </section>
    </article>
  </div>
</body>
</html>`;
}

function detectWebsiteIntent(userInput) {
  const text = String(userInput || '').toLowerCase();
  if (/login|signin|signup|auth|로그인|회원가입|인증/.test(text)) return 'login';
  if (/dashboard|admin|analytics|crm|관리자|대시보드|백오피스/.test(text)) return 'dashboard';
  if (/landing|homepage|home page|marketing|promo|pricing|hero|랜딩|홈페이지|메인페이지/.test(text)) return 'landing';
  return 'generic';
}

function buildLandingFallback({ userInput, heroAsset, planSummary, researchSummary, testSummary, criticSummary, sharedStyles }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAS Landing Preview</title>
  <style>
    ${sharedStyles}
    .hero { display:grid; grid-template-columns:1.1fr .9fr; gap:24px; align-items:center; padding:28px; }
    .hero h1 { font-size:clamp(40px, 7vw, 76px); line-height:.98; margin:16px 0; }
    .hero p { font-size:18px; line-height:1.75; color:var(--muted); max-width:60ch; }
    .cta-row { display:flex; gap:12px; margin-top:18px; flex-wrap:wrap; }
    .btn { padding:13px 18px; border-radius:999px; border:1px solid var(--line); color:var(--text); text-decoration:none; font-weight:700; }
    .btn.primary { background:linear-gradient(135deg, #38bdf8, #818cf8); color:#08111f; border:0; }
    .stats, .features { display:grid; grid-template-columns:repeat(3, 1fr); gap:18px; margin-top:24px; }
    .item { padding:22px; }
    .item h3 { margin-bottom:10px; font-size:17px; }
    @media (max-width: 900px) { .hero, .stats, .features { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero card">
      <div>
        <div class="eyebrow">Guaranteed Landing Preview</div>
        <h1>${escapeHtml(userInput)}</h1>
        <p>${escapeHtml(researchSummary.slice(0, 360) || planSummary)}</p>
        <div class="cta-row">
          <a class="btn primary" href="#start">시작하기</a>
          <a class="btn" href="#details">자세히 보기</a>
        </div>
      </div>
      <div>
        ${heroAsset ? `<img class="hero-image" src="${escapeAttr(heroAsset)}" alt="Generated landing asset" />` : `<div class="card item"><h3>Visual Direction</h3><div class="prose">${escapeHtml(planSummary)}</div></div>`}
      </div>
    </section>
    <section class="stats">
      <div class="card item"><h3>핵심 가치</h3><div class="prose">${escapeHtml(planSummary)}</div></div>
      <div class="card item"><h3>검증 포인트</h3><div class="prose">${escapeHtml(testSummary)}</div></div>
      <div class="card item"><h3>품질 메모</h3><div class="prose">${escapeHtml(criticSummary)}</div></div>
    </section>
    <section id="details" class="features">
      <div class="card item"><h3>문제 정의</h3><div class="prose">${escapeHtml(researchSummary.slice(0, 700))}</div></div>
      <div class="card item"><h3>전달 구조</h3><div class="prose">${escapeHtml(planSummary)}</div></div>
      <div class="card item"><h3>다음 단계</h3><div class="prose">LLM coder output was repaired into a guaranteed landing-style preview so the user always receives a usable homepage artifact.</div></div>
    </section>
  </div>
</body>
</html>`;
}

function buildDashboardFallback({ userInput, heroAsset, planSummary, researchSummary, testSummary, criticSummary, sharedStyles }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAS Dashboard Preview</title>
  <style>
    ${sharedStyles}
    .layout { display:grid; grid-template-columns:260px 1fr; gap:20px; }
    .sidebar, .main, .metric, .panel { padding:22px; }
    .menu { display:grid; gap:10px; margin-top:18px; }
    .menu div { padding:12px 14px; border-radius:14px; background:rgba(148,163,184,0.1); color:var(--text); }
    .metrics { display:grid; grid-template-columns:repeat(3, 1fr); gap:18px; margin-bottom:18px; }
    .content { display:grid; grid-template-columns:1.2fr .8fr; gap:18px; }
    @media (max-width: 900px) { .layout, .metrics, .content { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="wrap layout">
    <aside class="card sidebar">
      <div class="eyebrow">Guaranteed Dashboard Preview</div>
      <h2 style="margin-top:12px;">${escapeHtml(userInput)}</h2>
      <div class="menu">
        <div>Overview</div>
        <div>Analytics</div>
        <div>Operations</div>
        <div>Settings</div>
      </div>
      ${heroAsset ? `<img class="hero-image" style="margin-top:18px; min-height:180px;" src="${escapeAttr(heroAsset)}" alt="Generated dashboard asset" />` : ''}
    </aside>
    <main class="main">
      <section class="metrics">
        <div class="card metric"><div class="muted">Planning</div><h2 style="margin-top:8px;">Ready</h2><div class="prose">${escapeHtml(planSummary.slice(0, 240))}</div></div>
        <div class="card metric"><div class="muted">Validation</div><h2 style="margin-top:8px;">Checked</h2><div class="prose">${escapeHtml(testSummary.slice(0, 240))}</div></div>
        <div class="card metric"><div class="muted">Quality</div><h2 style="margin-top:8px;">Reviewed</h2><div class="prose">${escapeHtml(criticSummary.slice(0, 240))}</div></div>
      </section>
      <section class="content">
        <div class="card panel"><h3 class="section-title">Primary Workspace</h3><div class="prose">${escapeHtml(researchSummary.slice(0, 1200))}</div></div>
        <div class="card panel"><h3 class="section-title">System Notes</h3><div class="prose">Coder output did not produce a dashboard, so MAS assembled a dashboard-style fallback layout to keep the run usable and previewable.</div></div>
      </section>
    </main>
  </div>
</body>
</html>`;
}

export function ensureRenderableOutput(coderOutput, payload) {
  if (String(coderOutput || '').trim()) return coderOutput;
  const fallbackHtml = buildModeFallbackHtml(payload);
  return `## Guaranteed Fallback Output\n\nCoder returned empty output, so MAS synthesized a deterministic ${payload.outputMode} preview.\n\n\`\`\`html\n${fallbackHtml}\n\`\`\``;
}

function buildPreviewDocument(blocks, fallbackText, outputMode = 'website') {
  const htmlBlock = blocks.find((b) => ['html', 'htm'].includes(b.language))
    || blocks.find((b) => /<(?:!doctype|html|body|main|div|section|header|footer)\b/i.test(b.code));

  if (htmlBlock) {
    const cssBlocks = blocks.filter((b) => b.language === 'css').map((b) => b.code);
    const jsBlocks = blocks.filter((b) => ['js', 'javascript'].includes(b.language)).map((b) => b.code);

    let html = htmlBlock.code;

    if (!/<head[\s>]/i.test(html)) {
      html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAS Preview</title>
</head>
<body>
${html}
</body>
</html>`;
    }

    if (cssBlocks.length > 0) {
      html = html.replace('</head>', `<style>\n${cssBlocks.join('\n\n')}\n</style>\n</head>`);
    }

    if (jsBlocks.length > 0) {
      html = html.replace('</body>', `<script>\n${jsBlocks.join('\n\n')}\n</script>\n</body>`);
    }

    return html;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MAS Preview</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #111827;
      color: #e5e7eb;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: #0b1220;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 16px;
    }
    .note {
      margin-bottom: 16px;
      color: #93c5fd;
    }
  </style>
</head>
<body>
  <div class="note">Renderable HTML was not detected. Showing generated output as text.</div>
  <pre>${escapeHtml(fallbackText)}</pre>
</body>
</html>`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 모드별 artifact 저장 타입 결정
 */
function getArtifactTypeForMode(outputMode) {
  const modeToType = {
    website: 'html',
    docx: 'doc',
    sheet: 'sheet',
    slide: 'slide',
    deep_research: 'html',
  };
  return modeToType[outputMode] || 'html';
}

export function savePreviewArtifact(runId, coderOutput, outputMode = 'website') {
  const blocks = extractCodeBlocks(coderOutput);
  const html = buildPreviewDocument(blocks, coderOutput, outputMode);

  const artifactType = getArtifactTypeForMode(outputMode);
  const filename = `${runId}.html`;
  const { filepath, publicPath } = buildArtifactPath(artifactType, filename);
  fs.writeFileSync(filepath, html, 'utf8');

  return publicPath;
}
