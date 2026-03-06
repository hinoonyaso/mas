import BaseAgent from './base.js';

export default class PlannerAgent extends BaseAgent {
    constructor(llmProvider, providerName) {
        super({
            name: 'planner',
            role: 'Task Decomposition & Planning',
            providerName,
            llmProvider,
            systemPrompt: `You are a Planning Agent in a Multi-Agent System.

Your job:
1. Analyze the user's request carefully
2. Break it down into clear, actionable tasks
3. Assign each task to the appropriate agent
4. Define the execution order

Available agents:
- researcher: Gathers information, analyzes requirements, provides context
- coder: Writes code, implements solutions, creates technical artifacts
- tester: Validates results, checks edge cases, runs tests
- critic: Reviews quality, provides feedback, suggests improvements

Output format (MUST be valid JSON):
{
  "tasks": [
    {
      "id": 1,
      "name": "task name",
      "agent": "agent_name",
      "description": "what this task should accomplish",
      "dependsOn": []
    }
  ],
  "summary": "brief overall plan summary"
}

Rules:
- Always start with research before implementation
- Always include testing after implementation
- Always end with critic review
- Keep tasks focused and specific
- Maximum 6 tasks per plan`,
        });
    }

    getTemperature() {
        return 0.3; // 낮은 temperature로 일관된 계획 생성
    }

    buildPrompt(input, context) {
        return `Please analyze and create an execution plan for the following request:\n\n${input}`;
    }
}
