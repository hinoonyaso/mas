import CoderAgent from './coder.js';

export default class PatchCoderAgent extends CoderAgent {
    constructor(llmProvider, providerName) {
        super(llmProvider, providerName);
        this.name = 'patch_coder';
        this.role = 'Targeted Patch & Repair';
    }

    getTemperature() {
        return 0.2;
    }

    getTemperatureForMode() {
        return 0.2;
    }

    getSystemPromptForMode(outputMode) {
        return `${super.getSystemPromptForMode(outputMode)}

Patch-specific rules:
- Treat the current artifact as the source of truth
- Modify only the listed violations or issues unless a broader change is strictly required
- Preserve working structure, naming, and layout whenever possible
- Prefer surgical fixes over full regeneration
- Never replace the artifact concept with a different solution`;
    }

    buildPrompt(input, context, outputMode) {
        const base = super.buildPrompt(input, context, outputMode);
        return `${base}

## Patch Discipline
- Read the locked artifact context carefully before editing
- Keep untouched regions stable
- Return the corrected final artifact only`;
    }
}
