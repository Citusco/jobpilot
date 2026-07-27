# Implementation Plan: JD Structured Extraction and Candidate Training Direction Recommendation

**Branch**: `001-jd-training-directions` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-jd-training-directions/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Accept a free-form JD text, use one LLM call to extract role/tech-stack/seniority and
judge whether the information is sufficient (reject if not, FR-011); if sufficient, use a
second LLM call based on the structured summary + the JD original text to generate 3-6
(fewer than 3 allowed when information is sparse, FR-012) candidate training directions,
each with a traceable rationale, tags, and a suggested question count. Both LLM outputs
must pass their corresponding Zod schema validation before being passed downstream or
persisted (Constitution I). The whole flow is modeled as a LangGraph.js state graph
(extraction node → conditional edge → direction-generation node → persistence node),
with each node independently unit-testable and the LLM call mocked in tests (Constitution
II). The result is exposed through Fastify as a single synchronous HTTP endpoint, and
persisted to Postgres, associated with the JD submission record that produced it
(FR-013), for later reference by the question-generation stage. The LLM connects
directly to the OpenAI SDK, without going through the Agent Forge gateway (Constitution
IV, explicitly required at the current stage).

## Technical Context

**Language/Version**: TypeScript 5.4+ on Node.js 20 LTS, ES modules only

**Primary Dependencies**: Fastify 4.x; `@langchain/langgraph` (state graph
orchestration); the official `openai` SDK (including `zodResponseFormat` from
`openai/helpers/zod`, used to turn an existing Zod schema into the JSON schema required
by OpenAI Structured Outputs, so no extra schema-conversion library is needed); `zod`
(LLM structured-output validation + HTTP request-body validation); `drizzle-orm` +
`drizzle-kit` (Postgres ORM and schema/migration tooling — **a new dependency; the
constitution's tech-stack list only says "pgvector (in Postgres)" and does not name an
ORM/driver layer, so per CLAUDE.md's "do not introduce libraries not listed here without
discussing first" this is explicitly called out here; already confirmed with you —
Drizzle was chosen over the bare `pg` driver, see research.md §2 for the rationale**)

**Storage**: PostgreSQL (with the pgvector extension enabled, sharing the same instance
as the rest of the project; this feature's own two tables are purely relational data and
do not use vector columns — the pgvector extension is reserved for future
embedding-based features; no vector fields are forced in here where they aren't needed)

**Testing**: Jest + `ts-jest` (ESM preset) (**also a new technology choice — CLAUDE.md
only writes `npm run test` as a wrapper command and does not name a specific test
framework; already confirmed with you as Jest, see research.md §3 for the rationale: the
most mature ecosystem and the highest recognition in interviews/hiring; a pure ESM + TS
setup needs extra `ts-jest`/ESM configuration, but that configuration cost is itself
worth practicing once in a learning project**)

**Target Platform**: Linux server (a containerized Node.js service; this feature
currently has only a backend, no frontend)

**Project Type**: single project (backend-only web service)

**Performance Goals**: Not a high-concurrency scenario (an internal tool, with an
expected daily submission volume in the tens to low hundreds); per-request latency is
mainly determined by the serial duration of the two LLM calls; the target p95 end-to-end
(including persistence) is on the order of tens of seconds, well below the "complete one
round of evaluation within a few minutes" required by SC-004

**Constraints**:
- Raw, unvalidated LLM output must not enter downstream logic or be persisted
  (Constitution I)
- The candidate-direction count has an upper bound of 6, with the lower bound determined
  by how rich the information is (fewer than 3 is allowed, unbounded growth is not, and
  fabricating directions just to pad the count is not, FR-005/FR-012)
- When information is insufficient to identify role/tech-stack, the system must reject
  rather than return a low-confidence result (FR-011)
- Each direction's rationale must be traceable to the JD original text (FR-006), so the
  LLM call that generates the rationale must have access to the full JD original text,
  not just the post-extraction summary

**Scale/Scope**: A single-user-story MVP; database scope is 2 tables (JD submission
record, candidate training direction); a single HTTP endpoint

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
|---|---|---|
| I. Schema-Validated LLM I/O | Both LLM calls (extraction, direction generation) each define a corresponding Zod schema; the response is validated with `.parse()` successfully before entering graph state or being written to the database | PASS |
| II. Independently Testable LangGraph Nodes | The graph is split into 4 nodes (`extractJdStructure` / conditional edge / `generateCandidateDirections` / `persistSubmission`); unit tests mock the OpenAI client and the Drizzle client, without hitting the real API/DB | PASS |
| III. Plan-Before-Build for Structural Changes | This feature involves a new database schema (2 new tables) and a new LangGraph state graph design, so it must go through the full SDD flow — this plan is itself part of that flow; `/speckit-tasks` → `/speckit-implement` are still to come | PASS (in progress) |
| IV. Locked Technology Stack | Fastify / LangGraph.js / direct OpenAI SDK / Zod are all in the list and used consistently; `drizzle-orm`/`drizzle-kit` and `jest` are not named verbatim, and have been listed in the Complexity Tracking table below and confirmed with you | FLAGGED→confirmed (see the table below; a non-blocking violation — specific package choices not covered by the list, already decided) |
| V. Definition of Done: Typed, Tested, Reviewed | A corresponding unit test is planned for every node and every schema; the test plan for new logic will be independently reviewed by the `test-reviewer` subagent; the definition of done includes typecheck + lint + test all passing | PASS |

**Post-Design Re-check (after Phase 1)**: Re-checked after data-model.md / contracts /
quickstart.md were produced — the write path for the two tables (the `persistSubmission`
node) still completes within a transaction boundary, and no new cross-node shared
mutable state was introduced; the pairing of the two Zod schemas (`jdExtraction` /
`candidateDirections`) with `zodResponseFormat` did not add any dependency outside the
list; the only two FLAGGED items (`drizzle-orm`/`drizzle-kit` / `jest`) have not
expanded and remain consistent with the Phase 0 conclusion, and have already been
confirmed with the user. **Conclusion: PASS, no new violations.**

## Project Structure

### Documentation (this feature)

```text
specs/001-jd-training-directions/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── openapi.yaml
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── server.ts                          # Fastify app bootstrap entry point
├── routes/
│   └── jdSubmissions.ts               # POST /jd-submissions route
├── graph/
│   ├── state.ts                       # LangGraph state definition (rawText/extraction/directions/...)
│   ├── index.ts                       # the compiled StateGraph instance
│   └── nodes/
│       ├── extractJdStructure.ts      # Node 1: extraction + sufficiency judgment (single LLM call)
│       ├── generateCandidateDirections.ts  # Node 2: generate candidate directions (single LLM call)
│       └── persistSubmission.ts       # Node 3: transactionally write the JD submission record + candidate directions
├── llm/
│   └── openaiClient.ts                # thin wrapper around the OpenAI SDK client (direct connection, no gateway)
├── schemas/
│   ├── jdExtraction.schema.ts         # Zod schema for the extraction result (includes sufficient/insufficientReason)
│   └── candidateDirections.schema.ts  # Zod schema for the candidate-direction list
├── db/
│   ├── client.ts                       # Drizzle client initialization (based on the node-postgres driver)
│   ├── schema.ts                       # Drizzle schema: jdSubmissions / candidateTrainingDirections
│   ├── migrations/                     # SQL migrations generated by drizzle-kit (not hand-written)
│   └── repositories/
│       └── jdSubmissionRepository.ts   # persistence + lookup by id
└── types/
    └── index.ts

drizzle.config.ts                       # drizzle-kit config (schema path, migrations output dir, DATABASE_URL)

tests/
├── unit/
│   ├── graph/
│   │   ├── extractJdStructure.test.ts
│   │   ├── generateCandidateDirections.test.ts
│   │   └── persistSubmission.test.ts
│   └── schemas/
│       ├── jdExtraction.schema.test.ts
│       └── candidateDirections.schema.test.ts
├── contract/
│   └── jdSubmissions.contract.test.ts # validates request/response shape against contracts/openapi.yaml
└── integration/
    └── jdSubmissionFlow.test.ts       # runs the full graph (LLM/DB both mocked), covering the spec's three Acceptance Scenarios
```

**Structure Decision**: A single-project structure (Option 1) is used. At this stage,
JobPilot has only a backend and no frontend, so the backend/frontend split of Option 2 is
not used. The LangGraph graph code is separated into `src/graph/`, to support the
node-level independent testing required by Constitution II; Zod schemas are centralized
in `src/schemas/`, serving both LLM structured-output validation and (in the future)
reuse at the HTTP layer.

## Complexity Tracking

> The following two items are not violations or replacements of the existing Locked
> Technology Stack, but specific package choices that the list does not name and that
> someone must explicitly decide on (Constitution IV: "MUST NOT be added silently").
> Already confirmed with the user; the basis for the decision is the specific context
> that "this is a job-hunting/learning project", rather than the purely simplest
> implementation path.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New dependency `drizzle-orm` + `drizzle-kit` | The constitution only lists Postgres/pgvector as the tech stack and does not name an ORM/driver layer; FR-013's persistence needs some form of data access | The bare `pg` driver is simpler to implement (no extra abstraction layer), but the user explicitly wants to use this project to practice schema-as-code / a type-safe query builder / a migration workflow — skills more aligned with the current hiring market — so Drizzle was adopted per the user's decision |
| New test framework `jest` (+ `ts-jest` ESM preset) | CLAUDE.md only defines the wrapper command `npm run test` and does not name a specific framework; Constitution II requires LangGraph nodes to be independently unit-testable with the LLM mocked | Vitest has zero configuration and lower complexity for a pure ESM + TS project, but Jest has higher recognition and more resources in the hiring market; the user explicitly chose Jest, which needs extra `ts-jest` configuration (or an equivalent ESM transpilation setup) to support pure ESM |
