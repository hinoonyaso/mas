import fs from 'fs';
import path from 'path';
import https from 'https';
import BaseAgent from './base.js';
import { ensureArtifactFolders } from '../artifacts/storage.js';

export default class AssetAgent extends BaseAgent {
    constructor(llmProvider, providerName) {
        super({
            name: 'asset',
            role: 'Media Asset Generation',
            providerName,
            llmProvider,
            systemPrompt: `You are an Asset Generation Agent in a Multi-Agent System.
Your job is to determine if the user's request requires any custom images (like backgrounds, banners, logos, or illustrations) for a premium UI/UX design.

Analyze the user's request, the planner's tasks, and the planner's assetPlan (if provided).
The assetPlan specifies exactly which sections/slides need assets, what type (hero, background, icon_set, diagram), what style, and what fallback to use.

If no image is needed and no assetPlan is provided, output EXACTLY AND ONLY this JSON:
{"generate": false}

If an image is needed (either from assetPlan or your own analysis), create a highly detailed, descriptive text prompt in English suitable for an AI image generator (like Midjourney or Pollinations). The prompt should be completely self-contained and describe the visual style, colors, subject matter, and mood.
Output EXACTLY AND ONLY this JSON:
{
  "generate": true,
  "filename": "descriptive_name.png",
  "prompt": "Highly detailed english prompt for the image...",
  "target": "which section/slide this asset is for (from assetPlan if available)",
  "style": "style direction from assetPlan or inferred"
}`,
        });
    }

    getTemperature() {
        return 0.4;
    }

    buildPrompt(input, context) {
        let prompt = `Analyze this request and determine if generating a premium image asset is required to fulfill the design needs:\n\nUser Request: ${input}\n\nContext:\n${typeof context === 'string' ? context : JSON.stringify(context)}`;

        // assetPlan이 있으면 참조
        if (context && context.artifactContract && context.artifactContract.assetPlan) {
            prompt += `\n\n## Asset Plan (from Planner)\n${JSON.stringify(context.artifactContract.assetPlan, null, 2)}\n\nUse the assetPlan above to determine what asset to generate. Match the target, type, and style specified.`;
        }

        return prompt;
    }

    async parseLLMOutput(text) {
        try {
            // Find JSON block in the text in case the LLM wrapped it in markdown
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const jsonText = jsonMatch ? jsonMatch[0] : text;
            const parsed = JSON.parse(jsonText);
            return parsed;
        } catch (e) {
            console.error('Failed to parse Asset Agent JSON:', e);
            // Default to no generation on error
            return { generate: false };
        }
    }

    async downloadImage(prompt, filename) {
        return new Promise((resolve, reject) => {
            // Use pollinations.ai for free text-to-image generation
            const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?nologo=true&width=1280&height=720`;

            // Ensure assets directory exists
            ensureArtifactFolders();
            const publicDir = path.resolve(process.cwd(), '../client/public');
            const assetsDir = path.join(publicDir, 'assets');
            const filepath = path.join(assetsDir, filename);

            console.log(`[AssetAgent] Downloading image from ${url} to ${filepath}`);

            https.get(url, (response) => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    // Handle redirect
                    https.get(response.headers.location, (res) => {
                        this._collectImageResponse(res, filepath, filename, resolve, reject);
                    }).on('error', (err) => {
                        reject(err);
                    });
                } else {
                    this._collectImageResponse(response, filepath, filename, resolve, reject);
                }
            }).on('error', (err) => {
                reject(err);
            });
        });
    }

    _collectImageResponse(response, filepath, filename, resolve, reject) {
        const chunks = [];

        response.on('data', (chunk) => {
            chunks.push(chunk);
        });

        response.on('end', () => {
            try {
                const buffer = Buffer.concat(chunks);
                const contentType = String(response.headers['content-type'] || '').toLowerCase();

                if (!this._isValidImagePayload(buffer, contentType)) {
                    reject(new Error(`Invalid image response (status=${response.statusCode}, content-type=${contentType || 'unknown'})`));
                    return;
                }

                fs.writeFileSync(filepath, buffer);
                resolve(`/assets/${filename}`);
            } catch (error) {
                reject(error);
            }
        });

        response.on('error', reject);
    }

    _isValidImagePayload(buffer, contentType) {
        if (!buffer || buffer.length < 32) return false;
        if (contentType && !contentType.startsWith('image/')) return false;

        const png = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
        const jpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
        const gif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
        const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
        const svg = buffer.toString('utf8', 0, Math.min(buffer.length, 256)).includes('<svg');

        return png || jpg || gif || webp || svg;
    }

    createFallbackAsset(prompt, filename) {
        ensureArtifactFolders();
        const publicDir = path.resolve(process.cwd(), '../client/public');
        const assetsDir = path.join(publicDir, 'assets');
        const baseName = path.parse(filename).name || 'generated-asset';
        const fallbackFilename = `${baseName}.svg`;
        const filepath = path.join(assetsDir, fallbackFilename);
        const title = this._escapeXml(baseName.replace(/[-_]+/g, ' '));
        const subtitle = this._escapeXml(prompt.slice(0, 140));

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${subtitle}</desc>
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#020617" />
      <stop offset="55%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#0f766e" />
    </linearGradient>
    <linearGradient id="orb" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.95" />
      <stop offset="100%" stop-color="#818cf8" stop-opacity="0.25" />
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)" />
  <circle cx="1260" cy="160" r="220" fill="url(#orb)" opacity="0.85" />
  <circle cx="260" cy="780" r="280" fill="#0891b2" opacity="0.18" />
  <rect x="120" y="120" width="1360" height="660" rx="36" fill="rgba(15,23,42,0.52)" stroke="rgba(148,163,184,0.35)" />
  <text x="180" y="260" fill="#e2e8f0" font-size="64" font-family="Inter, Arial, sans-serif" font-weight="700">${title}</text>
  <text x="180" y="340" fill="#7dd3fc" font-size="26" font-family="Inter, Arial, sans-serif">Fallback preview asset generated locally</text>
  <foreignObject x="180" y="400" width="1100" height="220">
    <div xmlns="http://www.w3.org/1999/xhtml" style="color:#cbd5e1;font:24px Inter, Arial, sans-serif;line-height:1.55;">
      ${subtitle}
    </div>
  </foreignObject>
</svg>`;

        fs.writeFileSync(filepath, svg, 'utf8');
        return `/assets/${fallbackFilename}`;
    }

    _escapeXml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    // Override the execute method to intercept the LLM output and perform the download
    async execute(input, context, model) {
        try {
            const result = await super.execute(input, context, model);
            if (!result.success) return result;

            const decision = await this.parseLLMOutput(result.output);

            if (decision.generate && decision.prompt && decision.filename) {
                try {
                    const localPath = await this.downloadImage(decision.prompt, decision.filename);
                    const finalOutput = `I have generated a premium asset based on the requirements.\n\n**Prompt Used**: ${decision.prompt}\n**File Saved At**: \`${localPath}\`\n\n*Coder Agent: Please use this file path (\`${localPath}\`) in your HTML/CSS implementation to apply the generated image.*`;

                    return {
                        success: true,
                        output: finalOutput,
                        log: result.log
                    };
                } catch (err) {
                    const fallbackPath = this.createFallbackAsset(decision.prompt, decision.filename);
                    return {
                        success: true,
                        output: `Image download failed, so a local fallback visual was created instead.\n\n**Prompt Used**: ${decision.prompt}\n**Fallback File Saved At**: \`${fallbackPath}\`\n**Download Error**: ${err.message}\n\n*Coder Agent: Please use this fallback file path (\`${fallbackPath}\`) in your HTML/CSS implementation to apply the generated image.*`,
                        log: result.log
                    };
                }
            } else {
                return {
                    success: true,
                    output: 'No visual assets needed for this request. Proceeding with standard implementation.',
                    log: result.log
                };
            }
        } catch (error) {
            return {
                success: false,
                output: null,
                error: error.message,
            };
        }
    }
}
