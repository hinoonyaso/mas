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

Analyze the user's request and the planner's tasks.
If no image is needed, output EXACTLY AND ONLY this JSON:
{"generate": false}

If an image is needed, create a highly detailed, descriptive text prompt in English suitable for an AI image generator (like Midjourney or Pollinations). The prompt should be completely self-contained and describe the visual style, colors, subject matter, and mood.
Output EXACTLY AND ONLY this JSON:
{
  "generate": true,
  "filename": "descriptive_name.png",
  "prompt": "Highly detailed english prompt for the image..."
}`,
        });
    }

    getTemperature() {
        return 0.4;
    }

    buildPrompt(input, context) {
        return `Analyze this request and determine if generating a premium image asset is required to fulfill the design needs:\n\nUser Request: ${input}\n\nContext:\n${context}`;
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
            const file = fs.createWriteStream(filepath);

            console.log(`[AssetAgent] Downloading image from ${url} to ${filepath}`);

            https.get(url, (response) => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    // Handle redirect
                    https.get(response.headers.location, (res) => {
                        res.pipe(file);
                        file.on('finish', () => {
                            file.close();
                            resolve(`/assets/${filename}`);
                        });
                    }).on('error', (err) => {
                        fs.unlink(filepath, () => { });
                        reject(err);
                    });
                } else {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve(`/assets/${filename}`);
                    });
                }
            }).on('error', (err) => {
                fs.unlink(filepath, () => { });
                reject(err);
            });
        });
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
                    return {
                        success: false,
                        error: `Failed to download image: ${err.message}`,
                        output: `Failed to download image: ${err.message}`,
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
