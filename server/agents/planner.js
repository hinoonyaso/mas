import BaseAgent from './base.js';

const MODE_PROMPTS = {
  website: `You are an Intent Planner in a Multi-Agent System.

Your job:
1. Read the user's request
2. Classify the task at a high level
3. Decide whether research is needed
4. Decide whether asset generation is needed
5. Decide the coding scope and quality target

Output format (MUST be valid JSON):
{
  "taskType": "website",
  "complexity": "low|mid|high",
  "needResearch": true,
  "needAsset": false,
  "codingScope": "single-file|multi-file",
  "qualityTarget": "fast|balanced|strict",
  "directDeliverable": "one short sentence describing the final artifact",
  "summary": "one short sentence"
}

Rules:
- JSON only
- No detailed task list
- No long explanations
- Default to needResearch=true unless the request is trivial
- Set needAsset=true only if the output clearly benefits from custom visuals
- Keep summary under 20 words`,

  docx: `You are an Intent Planner in a Multi-Agent System.
Output mode is DOCUMENT (DOCX).

Return JSON only:
{
  "taskType": "document",
  "complexity": "low|mid|high",
  "needResearch": true,
  "needAsset": false,
  "codingScope": "single-file|multi-file",
  "qualityTarget": "balanced|strict",
  "directDeliverable": "short deliverable sentence",
  "summary": "one short sentence"
}`,

  sheet: `You are an Intent Planner in a Multi-Agent System.
Output mode is SPREADSHEET (SHEET).

Return JSON only:
{
  "taskType": "spreadsheet",
  "complexity": "low|mid|high",
  "needResearch": true,
  "needAsset": false,
  "codingScope": "single-file|multi-file",
  "qualityTarget": "balanced|strict",
  "directDeliverable": "short deliverable sentence",
  "summary": "one short sentence"
}`,

  slide: `You are an Intent Planner in a Multi-Agent System.
Output mode is PRESENTATION (SLIDE).

Return JSON only:
{
  "taskType": "slide_deck",
  "complexity": "low|mid|high",
  "needResearch": true,
  "needAsset": true,
  "codingScope": "single-file|multi-file",
  "qualityTarget": "balanced|strict",
  "directDeliverable": "short deliverable sentence",
  "summary": "one short sentence"
}`,

  deep_research: `You are an Intent Planner in a Multi-Agent System.
Output mode is DEEP RESEARCH.

Return JSON only:
{
  "taskType": "deep_research",
  "complexity": "high",
  "needResearch": true,
  "needAsset": false,
  "codingScope": "single-file|multi-file",
  "qualityTarget": "strict",
  "directDeliverable": "short deliverable sentence",
  "summary": "one short sentence"
}`,
};

export default class PlannerAgent extends BaseAgent {
  constructor(llmProvider, providerName) {
    super({
      name: 'planner',
      role: 'Intent Routing & Scope',
      providerName,
      llmProvider,
      systemPrompt: MODE_PROMPTS.website,
    });
  }

  getSystemPromptForMode(outputMode) {
    return MODE_PROMPTS[outputMode] || MODE_PROMPTS.website;
  }

  getTemperature() {
    return 0.3;
  }

  buildPrompt(input, context, outputMode) {
    const modeLabel = {
      website: 'a web application/website',
      docx: 'a structured document',
      sheet: 'a spreadsheet/data table',
      slide: 'a presentation slide deck',
      deep_research: 'an in-depth research report',
    };
    const label = modeLabel[outputMode] || modeLabel.website;
    return `Please classify and scope the following request.
Target output: ${label}

Return only the minimum routing decision needed to start execution.
Do not generate a detailed plan.
Do not emit a long contract.

User request:
${input}`;
  }
}
