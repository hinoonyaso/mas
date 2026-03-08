function detectArtifactType(filePath) {
    const lower = String(filePath || '').toLowerCase();
    if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lower)) return 'image';
    if (/\.(html|htm)$/.test(lower)) return 'html';
    if (/\.pdf$/.test(lower)) return 'pdf';
    if (/\.(ppt|pptx|key)$/.test(lower)) return 'slide';
    if (/\.(doc|docx)$/.test(lower)) return 'doc';
    if (/\.(xls|xlsx|csv)$/.test(lower)) return 'sheet';
    if (/\.(mp4|webm|mov)$/.test(lower)) return 'video';
    return 'file';
}

function extractPathsFromText(text) {
    const matches = new Set();
    if (!text) return [];

    const patterns = [
        /`(\/(?:assets|homepage|slide|docx|sheets|generated)\/[^`\s]+)`/g,
        /\b(\/(?:assets|homepage|slide|docx|sheets|generated)\/[^\s)]+)\b/g,
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            matches.add(match[1]);
        }
    }

    return [...matches];
}

export function collectArtifacts(steps, previewPath, outputMode = 'website') {
    const artifacts = [];
    const seen = new Set();
    const collectibleAgents = new Set(['asset', 'coder', 'patch_coder']);
    const previewLabels = {
        website: 'Website preview',
        docx: 'Document preview',
        sheet: 'Spreadsheet preview',
        slide: 'Presentation preview',
        deep_research: 'Research report preview',
    };

    if (previewPath) {
        seen.add(previewPath);
        artifacts.push({
            path: previewPath,
            type: detectArtifactType(previewPath),
            sourceAgent: 'coder',
            label: previewLabels[outputMode] || 'Rendered preview',
        });
    }

    for (const step of steps || []) {
        if (!collectibleAgents.has(step.agent)) continue;
        if (step.artifact?.path && !seen.has(step.artifact.path)) {
            seen.add(step.artifact.path);
            artifacts.push({
                path: step.artifact.path,
                type: detectArtifactType(step.artifact.path),
                sourceAgent: step.agent,
                label: step.artifact.fallbackUsed ? `${step.agent} artifact (fallback)` : `${step.agent} artifact`,
                artifactId: step.artifact.id,
                artifactHash: step.artifact.hash,
                parentArtifactHash: step.artifact.parentArtifactHash || null,
                runId: step.artifact.runId || null,
                fallbackUsed: Boolean(step.artifact.fallbackUsed),
                fallbackReason: step.artifact.fallbackReason || null,
            });
        }
        const paths = extractPathsFromText(step.output);
        for (const filePath of paths) {
            if (seen.has(filePath)) continue;
            seen.add(filePath);
            artifacts.push({
                path: filePath,
                type: detectArtifactType(filePath),
                sourceAgent: step.agent,
                label: `${step.agent} artifact`,
                parentArtifactHash: step.artifact?.hash || null,
            });
        }
    }

    return artifacts;
}
