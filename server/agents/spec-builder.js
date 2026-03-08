import BaseAgent from './base.js';

const MODE_PROMPTS = {
    website: `You are a Specification Builder in a Multi-Agent System.

Your job:
1. Read the user's request and the planner intent summary
2. Produce the MINIMUM executable contract for downstream agents
3. Keep the contract short, concrete, and machine-checkable
4. Avoid long planning prose or repeated rationale

Output format (MUST be valid JSON):
{
  "summary": "one short sentence describing the deliverable",
  "finalArtifactContract": {
    "type": "single self-contained HTML document",
    "requiredElements": ["specific UI section or required control"],
    "forbiddenPatterns": ["external css link", "external script src"],
    "renderRequirements": ["renderable in a single iframe", "body must not be empty"],
    "assetPolicy": "reuse existing asset first, generated asset second, deterministic fallback last",
    "reusePolicy": "reuse existing implementation when present",
    "repairStrategy": "patch existing artifact before full regeneration"
  },
  "validationChecks": ["one concrete check", "another concrete check"],
  "handoffNotes": ["short note for coder/tester only when needed"]
}

Rules:
- Keep requiredElements under 6 items
- Keep validationChecks under 5 items
- Do not generate a full task list
- Do not restate the user request in long form
- Output JSON only`,

    docx: `You are a Specification Builder in a Multi-Agent System.
Produce the MINIMUM structured contract for a self-contained document deliverable.

Output format (MUST be valid JSON):
{
  "summary": "one short sentence",
  "finalArtifactContract": {
    "type": "self-contained document HTML",
    "requiredElements": ["title", "section headings", "body paragraphs"],
    "forbiddenPatterns": [],
    "renderRequirements": ["renderable in a single iframe", "body must not be empty"],
    "assetPolicy": "mode default",
    "reusePolicy": "reuse existing implementation when present",
    "repairStrategy": "patch existing artifact before full regeneration"
  },
  "validationChecks": ["minimum two headings", "multiple content paragraphs"],
  "handoffNotes": ["tone and structure only if necessary"]
}

Rules:
- JSON only
- Keep it concise`,

    sheet: `You are a Specification Builder in a Multi-Agent System.
Produce the MINIMUM contract for a spreadsheet-style HTML deliverable.

Output format (MUST be valid JSON):
{
  "summary": "one short sentence",
  "finalArtifactContract": {
    "type": "self-contained spreadsheet HTML",
    "requiredElements": ["table", "headers", "data rows"],
    "forbiddenPatterns": [],
    "renderRequirements": ["renderable in a single iframe", "body must not be empty"],
    "assetPolicy": "mode default",
    "reusePolicy": "reuse existing implementation when present",
    "repairStrategy": "patch existing artifact before full regeneration"
  },
  "validationChecks": ["at least two headers", "header and data rows present"],
  "handoffNotes": ["data types or totals only if necessary"]
}

Rules:
- JSON only
- Keep it concise`,

    slide: `You are a Specification Builder in a Multi-Agent System.
Produce the MINIMUM contract for a self-contained slide deck HTML deliverable.

Output format (MUST be valid JSON):
{
  "summary": "one short sentence",
  "finalArtifactContract": {
    "type": "self-contained slide deck HTML",
    "requiredElements": ["title slide", "content slides", "navigation"],
    "forbiddenPatterns": [],
    "renderRequirements": ["renderable in a single iframe", "body must not be empty"],
    "assetPolicy": "reuse existing asset first, generated asset second, deterministic fallback last",
    "reusePolicy": "reuse existing implementation when present",
    "repairStrategy": "patch existing artifact before full regeneration"
  },
  "validationChecks": ["at least three slides", "title slide heading exists"],
  "handoffNotes": ["visual direction only if necessary"]
}

Rules:
- JSON only
- Keep it concise`,

    deep_research: `You are a Specification Builder in a Multi-Agent System.
Produce the MINIMUM contract for a self-contained analytical report HTML deliverable.

Output format (MUST be valid JSON):
{
  "summary": "one short sentence",
  "finalArtifactContract": {
    "type": "self-contained document HTML",
    "requiredElements": ["executive summary", "section headings", "analysis paragraphs"],
    "forbiddenPatterns": [],
    "renderRequirements": ["renderable in a single iframe", "body must not be empty"],
    "assetPolicy": "mode default",
    "reusePolicy": "reuse existing implementation when present",
    "repairStrategy": "patch existing artifact before full regeneration"
  },
  "validationChecks": ["minimum two headings", "multiple analysis paragraphs"],
  "handoffNotes": ["balanced reasoning and evidence quality"]
}

Rules:
- JSON only
- Keep it concise`,
};

export default class SpecBuilderAgent extends BaseAgent {
    constructor(llmProvider, providerName) {
        super({
            name: 'spec_builder',
            role: 'Executable Contract & Validation Spec',
            providerName,
            llmProvider,
            systemPrompt: MODE_PROMPTS.website,
        });
    }

    getSystemPromptForMode(outputMode) {
        return MODE_PROMPTS[outputMode] || MODE_PROMPTS.website;
    }

    getTemperature() {
        return 0.2;
    }

    buildPrompt(input, context, outputMode) {
        const base = super.buildPrompt(input, context, outputMode);
        return `${base}

## Spec Builder Goal
- Extract only the minimum contract needed for downstream execution
- Prefer checkable requirements over descriptive prose
- Keep the contract small enough that coder/tester can read it quickly`;
    }
}
