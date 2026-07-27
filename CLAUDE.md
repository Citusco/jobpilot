# JobPilot — Live Coding Training Generator

## Bash commands
- npm run dev: start the local dev server
- npm run test: run unit tests
- npm run typecheck: TypeScript type checking
- npm run lint: ESLint check

## Tech stack (do not introduce libraries not listed here without discussing first)
- Backend: Node.js + TypeScript + Fastify
- Orchestration: LangGraph.js
- Vector store: pgvector (in Postgres)
- Data pipeline: AWS (S3 + EventBridge + Lambda + Step Functions + DynamoDB)
- Sandbox: Judge0 (self-hosted)

## LLM calls (current stage)
Call the provider SDK directly (OpenAI / Bedrock) — no need to route through any gateway.
We will eventually migrate to the Agent Forge gateway for unified routing and budget
management, but this is not strongly enforced at the current stage — get the business
logic working first; migrating to the gateway is a separate, independent refactor for later.

## Code style
- ES modules (import/export), no CommonJS
- Use Zod for runtime validation; LLM structured output must have a corresponding Zod schema

## Testing
- A new feature isn't done until it has corresponding tests
- Test LangGraph nodes individually, mocking out the LLM call — do not hit real APIs in unit tests
- For tests covering new logic, prefer requesting an independent review from the test-reviewer subagent (to avoid the implementer writing tests and grading their own work)

## Workflow (Spec-Driven Development)
This project uses GitHub Spec Kit to manage the development process. The core loop:
  /speckit-constitution (once only) → /speckit-specify → /speckit-plan → /speckit-tasks → /speckit-implement
- Tasks involving database schema, LangGraph state graph design, or cloud resource changes MUST go through the full SDD flow
- Small changes such as style adjustments or log format tweaks can go directly through Explore → Implement → Verify, no need for the full flow
- Each spec maps to one feature branch and one PR — do not modify main directly
- A task is not done until typecheck + lint + test all pass
- If this task touches a new technical topic or a notable pitfall, offer to generate a learning note once it's done
- Language policy: All content committed to this repository must be written in English — this includes code comments, commit messages, PR titles and descriptions, README and other documentation, and Spec Kit-generated documents (spec.md, plan.md, tasks.md, research.md, data-model.md, quickstart.md). This applies even when the user's instructions to Claude are given in Chinese — interactive chat with the user may be in Chinese, but everything written to a file or committed to the repository must be in English regardless of the language used in the conversation.
