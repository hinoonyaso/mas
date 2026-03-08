/**
 * artifactPublisher.js — artifact 스냅샷 저장, 해시, broadcast, 최종 출력 조합
 */

import crypto from 'crypto';
import { savePreviewArtifact } from '../artifacts/preview.js';

export function createArtifactPublisher(broadcast) {
    return {
        publishArtifactSnapshot(runId, codeResult, steps, outputMode) {
            const previewPath = savePreviewArtifact(runId, codeResult.output, outputMode);
            const hash = crypto.createHash('sha256').update(String(codeResult.output || '')).digest('hex');
            const artifact = {
                id: `artifact-${hash.slice(0, 12)}`,
                hash,
                path: previewPath,
                type: outputMode,
                producedBy: 'coder',
                content: String(codeResult.output || '').slice(0, 12000),
            };

            const latestStep = steps[steps.length - 1];
            if (latestStep?.agent === 'coder' || latestStep?.agent === 'patch_coder') {
                latestStep.artifact = artifact;
            }

            broadcast('artifact:published', artifact);
            return artifact;
        },

        composeFinalOutput(steps) {
            return steps
                .filter((s) => s.success && s.output)
                .map((s) => `## ${s.agent.charAt(0).toUpperCase() + s.agent.slice(1)} Agent (${s.role})\n\n${s.output}`)
                .join('\n\n---\n\n');
        },
    };
}
