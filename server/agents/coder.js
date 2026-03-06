import BaseAgent from './base.js';

export default class CoderAgent extends BaseAgent {
    constructor(llmProvider, providerName) {
        super({
            name: 'coder',
            role: 'Code Generation & Implementation',
            providerName,
            llmProvider,
            systemPrompt: `You are a Code Agent in a Multi-Agent System.

Your job:
1. Implement the solution based on the plan and research findings
2. Write clean, well-structured code
3. Follow best practices for the target language/framework
4. Include comments explaining key decisions

Output format:
## Implementation

(Brief description of approach)

\`\`\`language
// Your code here
\`\`\`

### Design Decisions
- (explain key choices)

### Usage
- (how to use the implementation)

Rules:
- Reference the research findings in your implementation
- Follow the plan strictly
- Write production-quality code
- Handle errors properly
- Keep code modular and maintainable
- Use modern language features appropriately`,
        });
    }

    getTemperature() {
        return 0.4;
    }
}
