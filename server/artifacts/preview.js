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

function buildPreviewDocument(blocks, fallbackText) {
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

export function savePreviewArtifact(runId, coderOutput) {
    if (!coderOutput) return null;

    const blocks = extractCodeBlocks(coderOutput);
    const html = buildPreviewDocument(blocks, coderOutput);

    const filename = `${runId}.html`;
    const { filepath, publicPath } = buildArtifactPath('html', filename);
    fs.writeFileSync(filepath, html, 'utf8');

    return publicPath;
}
