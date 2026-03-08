/**
 * intentRouter.js — Planner/SpecBuilder LLM 출력 파싱 (순수 함수)
 */

export function extractPlanJson(planOutput) {
    const text = String(planOutput || '');
    const fenced = text.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text.match(/\{[\s\S]*\}/)?.[0];
    if (!candidate) return null;
    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

export function resolveIntentPlan(planOutput, outputMode, userInput) {
    const parsed = extractPlanJson(planOutput) || {};
    const defaultNeedAsset = outputMode === 'slide'
        || /landing|hero|banner|branding|background|illustration|marketing|premium|visual/i.test(String(userInput || ''));

    return {
        taskType: parsed.taskType || outputMode,
        complexity: parsed.complexity || 'mid',
        needResearch: parsed.needResearch !== false,
        needAsset: Boolean(parsed.needAsset ?? defaultNeedAsset),
        codingScope: parsed.codingScope || 'single-file',
        qualityTarget: parsed.qualityTarget || (outputMode === 'deep_research' ? 'strict' : 'balanced'),
        directDeliverable: parsed.directDeliverable || `A directly previewable ${outputMode} artifact`,
        summary: parsed.summary || `Intent routed for ${outputMode} delivery.`,
    };
}

export function buildSpecBuilderInput(userInput, intentPlan, outputMode) {
    return `${userInput}

INTENT SUMMARY
- taskType: ${intentPlan.taskType}
- complexity: ${intentPlan.complexity}
- needResearch: ${intentPlan.needResearch}
- needAsset: ${intentPlan.needAsset}
- codingScope: ${intentPlan.codingScope}
- qualityTarget: ${intentPlan.qualityTarget}
- directDeliverable: ${intentPlan.directDeliverable}

Build the minimum executable contract for ${outputMode}.`;
}
