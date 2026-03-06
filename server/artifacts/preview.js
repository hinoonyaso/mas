import fs from 'fs';
import { buildArtifactPath } from './storage.js';

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
