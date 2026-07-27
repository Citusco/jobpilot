# Tasks: JD Structured Extraction and Candidate Training Direction Recommendation

**Input**: Design documents from `/specs/001-jd-training-directions/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml, quickstart.md

**Tests**: Included. The project constitution (Principle II: Independently Testable LangGraph Nodes; Principle V: Definition of Done) requires a corresponding test for every node and schema, with the LLM and DB mocked — this is a governance requirement, not an optional add-on for this feature.

**Organization**: Tasks are grouped by user story. This feature has a single user story (US1, P1), which is also the entire MVP scope (per spec.md: "this is the only user story in the current scope, and it is the entire content of the MVP").

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps the task to US1 (only used in Phase 3; Setup/Foundational/Polish carry no story label)
- Every description includes the exact file path to touch

## Jira Scrum Mapping (historical — superseded)

> **Note**: This section and the per-task mapping table below reflect the
> workflow in effect when T001–T006 were implemented (each task got its own
> Jira Subtask, branch, and PR). That model has been replaced: as of this
> amendment, one feature maps to exactly one Jira Story, tracked at
> `specs/001-jd-training-directions`, and `/speckit-implement` runs T007
> onward continuously on the feature branch with a single PR and no
> per-task Jira writes (see CLAUDE.md Workflow / constitution.md
> Development Workflow). SCRUM-6 through SCRUM-11 already exist and are not
> being undone; this note exists so future work on this file doesn't
> mistakenly recreate per-task subtasks for T007+.

This tasks.md was originally written to convert directly into Jira Scrum tickets in the `SCRUM` project (site `nathannan`, issue types available: Epic / Story / Task / Subtask) via the Atlassian MCP tool in a follow-up step. The mapping (historical record only):

| Spec Kit concept | Jira issue type | Notes |
|---|---|---|
| The feature itself (001-jd-training-directions) | **Epic** | Summary: "JD Structured Extraction and Candidate Training Direction Recommendation" |
| Each Phase below (Setup / Foundational / User Story 1 / Polish) | **Story** | Child of the Epic; summary = the phase name |
| Each individual checklist task (T0xx) | **Subtask** | Child of its phase's Story; summary = the task description; the file path goes in the Subtask description |

A ready-to-use row-per-task table for the import step is in [Jira Import Reference](#jira-import-reference) at the end of this file.

## Path Conventions

Single project (per plan.md Structure Decision): `src/`, `tests/`, and `drizzle.config.ts` at the repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Jira Story**: "Setup"

**Purpose**: Project initialization — this repository currently has no `package.json` or `src/` yet.

- [X] T001 Initialize the Node.js + TypeScript project: `package.json` (ES modules only, per CLAUDE.md), `tsconfig.json` (strict mode, Node.js 20 LTS target), and the empty `src/`/`tests/` folder skeleton from plan.md's Project Structure
- [X] T002 [P] Add runtime dependencies to `package.json`: `fastify`, `zod`, `openai`, `@langchain/langgraph`, `drizzle-orm`, and the Postgres driver Drizzle needs at runtime
- [ ] T003 [P] Add dev dependencies to `package.json`: `drizzle-kit`, `jest`, `ts-jest`, `@types/jest`, `eslint` (+ TypeScript ESLint plugin)
- [ ] T004 [P] Configure ESLint and add the `npm run dev` / `npm run test` / `npm run typecheck` / `npm run lint` scripts in `package.json` to match the commands documented in CLAUDE.md
- [ ] T005 [P] Configure Jest for ESM + TypeScript in `jest.config.ts` using the `ts-jest` ESM preset (per research.md §3)
- [ ] T006 [P] Create `drizzle.config.ts` at the repository root (schema path `src/db/schema.ts`, migrations output `src/db/migrations/`, reads `DATABASE_URL`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Jira Story**: "Foundational"

**Purpose**: Core infrastructure that MUST be complete before User Story 1 can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T007 Define the Drizzle schema for the `jd_submissions` and `candidate_training_directions` tables in `src/db/schema.ts`, using `pgTable(...)` from `drizzle-orm/pg-core` per data-model.md's field/constraint tables
- [ ] T008 Generate the initial migration with `drizzle-kit generate` into `src/db/migrations/` (depends on T007)
- [ ] T009 [P] Implement Drizzle client initialization in `src/db/client.ts`, based on the node-postgres driver and `DATABASE_URL` (depends on T007)
- [ ] T010 [P] Implement a thin OpenAI SDK client wrapper in `src/llm/openaiClient.ts` — connects directly using `OPENAI_API_KEY`, no gateway indirection (Constitution IV)
- [ ] T011 [P] Define the JD-extraction Zod schema in `src/schemas/jdExtraction.schema.ts` (`sufficient`, `insufficientReason`, `role`, `techStack`, `seniority`, `seniorityInferred`) per data-model.md
- [ ] T012 [P] Define the candidate-directions Zod schema in `src/schemas/candidateDirections.schema.ts` (`directions[]`, max 6, each with `name`/`rationale`/`tags`/`suggestedQuestionCount`) per data-model.md
- [ ] T013 Define the LangGraph state shape in `src/graph/state.ts` (`rawText`, extraction result, directions result, submission id, etc.) (depends on T011, T012)
- [ ] T014 Bootstrap the Fastify app entry point in `src/server.ts` (env config loading, plugin registration, `listen()`)

**Checkpoint**: Foundation ready — User Story 1 implementation can now begin

---

## Phase 3: User Story 1 - Extract JD structural information and generate candidate training directions (Priority: P1) 🎯 MVP

**Jira Story**: "User Story 1 (P1): Extract JD structure and generate candidate directions"

**Goal**: Accept a free-form JD text over HTTP and return a structured role/tech-stack/seniority summary plus 3-6 (or fewer, if information is sparse) candidate training directions, each with a rationale traceable to the JD text, tags, and a suggested question count — or a rejection response when the JD text is insufficient.

**Independent Test**: Per spec.md — paste a real JD text and check that the returned role/tech-stack/seniority summary is consistent with the JD content, and that the generated directions each include a traceable rationale + tags + suggested question count. This is the only user story in scope, so this checkpoint doubles as full-feature validation (see quickstart.md).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they FAIL before doing the corresponding implementation task.

- [ ] T015 [P] [US1] Unit test for the `extractJdStructure` node in `tests/unit/graph/extractJdStructure.test.ts` — mock the OpenAI client; assert the `sufficient`/`insufficient` branches and Zod-schema validation of the LLM output (FR-002, FR-003, FR-004, FR-010, FR-011)
- [ ] T016 [P] [US1] Unit test for the `generateCandidateDirections` node in `tests/unit/graph/generateCandidateDirections.test.ts` — mock the OpenAI client; assert the 0-6 direction count bound and Zod-schema validation (FR-005, FR-012)
- [ ] T017 [P] [US1] Unit test for the `persistSubmission` node in `tests/unit/graph/persistSubmission.test.ts` — mock the Drizzle client; assert both tables are written within a single transaction (FR-013)
- [ ] T018 [P] [US1] Unit test for the `jdExtraction` Zod schema in `tests/unit/schemas/jdExtraction.schema.test.ts` — valid/invalid shapes, `insufficientReason` required when `sufficient=false`
- [ ] T019 [P] [US1] Unit test for the `candidateDirections` Zod schema in `tests/unit/schemas/candidateDirections.schema.test.ts` — max 6 enforced, `tags` requires at least 1 item, `suggestedQuestionCount` must be positive
- [ ] T020 [P] [US1] Contract test for `POST /jd-submissions` in `tests/contract/jdSubmissions.contract.test.ts` — use Fastify's `inject()` to verify request/response shapes against `contracts/openapi.yaml` (201/422/400)
- [ ] T021 [US1] Integration test for the full JD-submission flow in `tests/integration/jdSubmissionFlow.test.ts` — LLM and DB both mocked; covers spec.md's 3 Acceptance Scenarios plus the 3 boundary scenarios from quickstart.md (depends on T015-T020 existing as the shape contract)

### Implementation for User Story 1

- [ ] T022 [P] [US1] Implement `jdSubmissionRepository` in `src/db/repositories/jdSubmissionRepository.ts` (insert both tables in one transaction + lookup by id) (depends on T009)
- [ ] T023 [P] [US1] Implement the `extractJdStructure` node in `src/graph/nodes/extractJdStructure.ts` — single LLM call via `openaiClient` using `zodResponseFormat`, followed by a `.parse()` re-check (depends on T010, T011; must satisfy T015)
- [ ] T024 [P] [US1] Implement the `generateCandidateDirections` node in `src/graph/nodes/generateCandidateDirections.ts` — single LLM call whose input is the structured extraction result **plus the full JD original text** (not just the summary), followed by a `.parse()` re-check (depends on T010, T012; must satisfy T016)
- [ ] T025 [US1] Implement the `persistSubmission` node in `src/graph/nodes/persistSubmission.ts`, calling `jdSubmissionRepository` (depends on T022; must satisfy T017)
- [ ] T026 [US1] Wire up the LangGraph `StateGraph` in `src/graph/index.ts`: `extractJdStructure` → conditional edge (`sufficient === false` → `rejectInput` terminal node) → `generateCandidateDirections` → `persistSubmission` (depends on T013, T023, T024, T025)
- [ ] T027 [US1] Implement the `POST /jd-submissions` Fastify route in `src/routes/jdSubmissions.ts` — validates the request body with Zod, invokes the compiled graph, and maps the final state to a 201/422 response per `contracts/openapi.yaml` (depends on T026; must satisfy T020, T021)
- [ ] T028 [US1] Register the `jdSubmissions` route (and a 400 handler for malformed request bodies) in `src/server.ts` (depends on T014, T027)

**Checkpoint**: User Story 1 is fully functional and independently testable — since it's the only story, this is also MVP-complete.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Jira Story**: "Polish & Cross-Cutting"

**Purpose**: Final validation and quality gates before calling the feature done

- [ ] T029 [P] Manually run all of quickstart.md's validation scenarios (3 Acceptance Scenarios + 3 boundary scenarios) against a running `npm run dev` server
- [ ] T030 Request an independent review of the tests added in T015-T021 from the `test-reviewer` subagent (Constitution V — avoid the implementer grading their own tests)
- [ ] T031 Run `npm run typecheck && npm run lint && npm run test` and fix any failures — this is the Definition of Done gate (Constitution V)
- [ ] T032 [P] If implementation surfaced a new technical pattern or a notable pitfall, offer to generate a learning note before closing out (CLAUDE.md Workflow)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS User Story 1
- **User Story 1 (Phase 3)**: Depends on Foundational phase completion. There is no other story to sequence or parallelize against — this phase is both the MVP and the entire remaining scope.
- **Polish (Phase 4)**: Depends on User Story 1 being complete

### Within Phase 3 (User Story 1)

- Tests (T015-T021) MUST be written and FAIL before their corresponding implementation tasks
- Repository (T022) before the node that calls it (T025)
- Nodes (T023, T024, T025) before wiring the graph (T026)
- Graph (T026) before the route that invokes it (T027)
- Route (T027) before registering it on the server (T028)

### Parallel Opportunities

- All Setup tasks marked [P] (T002-T006) can run in parallel once T001 exists
- Foundational tasks marked [P] (T009-T012) can run in parallel once T007/T008 exist
- Within Phase 3, all test tasks marked [P] (T015-T020) can run in parallel with each other
- Within Phase 3, the two LLM node implementations (T023, T024) and the repository (T022) marked [P] can run in parallel with each other

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Unit test for extractJdStructure node in tests/unit/graph/extractJdStructure.test.ts"
Task: "Unit test for generateCandidateDirections node in tests/unit/graph/generateCandidateDirections.test.ts"
Task: "Unit test for persistSubmission node in tests/unit/graph/persistSubmission.test.ts"
Task: "Unit test for jdExtraction schema in tests/unit/schemas/jdExtraction.schema.test.ts"
Task: "Unit test for candidateDirections schema in tests/unit/schemas/candidateDirections.schema.test.ts"
Task: "Contract test for POST /jd-submissions in tests/contract/jdSubmissions.contract.test.ts"

# Launch independent implementation pieces together:
Task: "Implement jdSubmissionRepository in src/db/repositories/jdSubmissionRepository.ts"
Task: "Implement extractJdStructure node in src/graph/nodes/extractJdStructure.ts"
Task: "Implement generateCandidateDirections node in src/graph/nodes/generateCandidateDirections.ts"
```

---

## Implementation Strategy

### MVP First (and only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks User Story 1)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: run quickstart.md's scenarios independently
5. Complete Phase 4: Polish, then this feature is done

There is no multi-story incremental-delivery or parallel-team-by-story strategy to plan for here — spec.md scopes this feature to a single user story, so Phase 3 is the entire build.

---

## Notes

- [P] tasks = different files, no dependencies
- [US1] label maps a task to User Story 1 for traceability (only story in scope)
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at the Phase 3 checkpoint to validate the story independently before moving to Polish
- Avoid: vague tasks, same-file conflicts

---

## Jira Import Reference

One row per task, ready to feed into the Atlassian MCP tool to create Jira issues in the `SCRUM` project. Create the Epic first, then the 4 Stories (each parented to the Epic), then each Subtask (parented to its Story).

**Epic**: JD Structured Extraction and Candidate Training Direction Recommendation

| Task ID | Jira Summary | Issue Type | Parent Story | Labels |
|---|---|---|---|---|
| — | Setup | Story | (Epic) | — |
| T001 | Initialize Node.js + TypeScript project skeleton | Subtask | Setup | setup |
| T002 | Add runtime dependencies to package.json | Subtask | Setup | setup, parallel |
| T003 | Add dev dependencies to package.json | Subtask | Setup | setup, parallel |
| T004 | Configure ESLint and npm scripts | Subtask | Setup | setup, parallel |
| T005 | Configure Jest for ESM + TypeScript | Subtask | Setup | setup, parallel |
| T006 | Create drizzle.config.ts | Subtask | Setup | setup, parallel |
| — | Foundational | Story | (Epic) | — |
| T007 | Define Drizzle schema for jd_submissions and candidate_training_directions | Subtask | Foundational | foundational |
| T008 | Generate initial Drizzle migration | Subtask | Foundational | foundational |
| T009 | Implement Drizzle client initialization | Subtask | Foundational | foundational, parallel |
| T010 | Implement OpenAI SDK client wrapper | Subtask | Foundational | foundational, parallel |
| T011 | Define jdExtraction Zod schema | Subtask | Foundational | foundational, parallel |
| T012 | Define candidateDirections Zod schema | Subtask | Foundational | foundational, parallel |
| T013 | Define LangGraph state shape | Subtask | Foundational | foundational |
| T014 | Bootstrap Fastify app entry point | Subtask | Foundational | foundational |
| — | User Story 1 (P1): Extract JD structure and generate candidate directions | Story | (Epic) | us1, p1 |
| T015 | Unit test: extractJdStructure node | Subtask | User Story 1 (P1) | us1, test, parallel |
| T016 | Unit test: generateCandidateDirections node | Subtask | User Story 1 (P1) | us1, test, parallel |
| T017 | Unit test: persistSubmission node | Subtask | User Story 1 (P1) | us1, test, parallel |
| T018 | Unit test: jdExtraction schema | Subtask | User Story 1 (P1) | us1, test, parallel |
| T019 | Unit test: candidateDirections schema | Subtask | User Story 1 (P1) | us1, test, parallel |
| T020 | Contract test: POST /jd-submissions | Subtask | User Story 1 (P1) | us1, test, parallel |
| T021 | Integration test: full JD submission flow | Subtask | User Story 1 (P1) | us1, test |
| T022 | Implement jdSubmissionRepository | Subtask | User Story 1 (P1) | us1, parallel |
| T023 | Implement extractJdStructure node | Subtask | User Story 1 (P1) | us1, parallel |
| T024 | Implement generateCandidateDirections node | Subtask | User Story 1 (P1) | us1, parallel |
| T025 | Implement persistSubmission node | Subtask | User Story 1 (P1) | us1 |
| T026 | Wire up LangGraph StateGraph | Subtask | User Story 1 (P1) | us1 |
| T027 | Implement POST /jd-submissions Fastify route | Subtask | User Story 1 (P1) | us1 |
| T028 | Register jdSubmissions route on server | Subtask | User Story 1 (P1) | us1 |
| — | Polish & Cross-Cutting | Story | (Epic) | — |
| T029 | Manually run quickstart.md validation scenarios | Subtask | Polish & Cross-Cutting | polish, parallel |
| T030 | Independent test review by test-reviewer subagent | Subtask | Polish & Cross-Cutting | polish |
| T031 | Run typecheck + lint + test and fix failures | Subtask | Polish & Cross-Cutting | polish |
| T032 | Offer to generate a learning note if applicable | Subtask | Polish & Cross-Cutting | polish, parallel |
