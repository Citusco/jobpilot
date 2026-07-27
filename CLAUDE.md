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

## Workflow
Full policy lives in `.specify/memory/constitution.md` (Development Workflow section) — this is the quick reference; that file wins on conflict.

**One feature = one Jira Story = one feature branch = one PR.** No per-task Jira issues, branches, or PRs — ever. Jira is synced twice per feature: start (In Progress) and finish (In Review/Done), not per task.

**Default (most work)**: `Explore → Short Plan → Implement → Typecheck/Lint/Test → PR`. No Spec Kit artifacts required.

**Full SDD (only for)**: database schema changes, LangGraph topology changes, RAG/retrieval architecture, AWS resource changes, or Judge0 security-boundary changes.
  `/speckit-specify → /speckit-plan → /speckit-tasks → /speckit-implement`
- `/speckit-specify` creates the feature branch + the feature's one Jira Story.
- `/speckit-plan` generates spec.md/plan.md/tasks.md by default; research.md, data-model.md, contracts/, quickstart.md only when genuinely needed — skipping them is the normal case, not a shortcut.
- tasks.md (T001, T002, ...) is an **internal checklist only** — never mapped to Jira subtasks.
- `/speckit-implement` runs all tasks continuously on the one feature branch — no branching, pushing, or Jira sync per task; push once and open one PR when the feature (or the requested stopping point) is done.
- `/speckit-clarify`, `/speckit-analyze`, `/speckit-converge` — optional, on-demand, invoke directly when needed.
- `/speckit-checklist`, `/speckit-taskstoissues` — not part of either workflow; invoke directly only for a specific one-off need.

**Definition of Done** (both workflows): acceptance criteria satisfied, new logic has tests, typecheck + lint + test all pass, important design decisions documented, PR completed, Jira Story updated.

- If a feature touches a new technical topic or a notable pitfall, offer to generate a learning note once it's done.
- The `ticket-wrapup` skill is mandatory once per feature, before the Jira Story is marked Done (in JobPilot, "the ticket" for that skill's purposes means the feature's one Jira Story, not a tasks.md task).
- Language policy: All content committed to this repository must be written in English — this includes code comments, commit messages, PR titles and descriptions, README and other documentation, and Spec Kit-generated documents (spec.md, plan.md, tasks.md, and any of research.md/data-model.md/quickstart.md/openapi.yaml when generated). This applies even when the user's instructions to Claude are given in Chinese — interactive chat with the user may be in Chinese, but everything written to a file or committed to the repository must be in English regardless of the language used in the conversation.
