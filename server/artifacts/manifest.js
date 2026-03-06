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

export function collectArtifacts(steps, previewPath) {
    const artifacts = [];
    const seen = new Set();

    if (previewPath) {
        seen.add(previewPath);
        artifacts.push({
            path: previewPath,
            type: detectArtifactType(previewPath),
            sourceAgent: 'coder',
            label: 'Rendered preview',
        });
    }

    for (const step of steps || []) {
        const paths = extractPathsFromText(step.output);
        for (const filePath of paths) {
            if (seen.has(filePath)) continue;
            seen.add(filePath);
            artifacts.push({
                path: filePath,
                type: detectArtifactType(filePath),
                sourceAgent: step.agent,
                label: `${step.agent} artifact`,
            });
        }
    }

    return artifacts;
}
