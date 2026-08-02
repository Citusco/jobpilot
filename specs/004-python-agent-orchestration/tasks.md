# Tasks: Python Agent Orchestration Service (FastAPI + LangGraph + LangChain)

**Input**: Design documents from `/specs/004-python-agent-orchestration/`

**Prerequisites**: plan.md, spec.md, research.md, quickstart.md

**Tests**: Included. Constitution Principle II requires every LangGraph node to be
independently unit-testable with the LLM call mocked — not optional for this project.

**Task granularity**: Per CLAUDE.md/`.claude/skills/speckit-tasks/SKILL.md`'s task-
granularity practice — two tasks collapse only when they're the same kind of work in the
same functional area AND have no ordering dependency. `extract_jd_structure` and
`generate_candidate_directions` are different functional units (different prompts,
different LLM calls, different business logic) even though both are "LLM nodes" — they
stay split, same precedent as SCRUM-38 keeping Prisma schema/migration split from
`PrismaService` code.

**Organization**: Single user story (P1) — this is the entire feature scope, same
situation as SCRUM-39.

## Format: `[ID] [P?] [Story] Description`

## Path Conventions

New top-level `agent-service/` directory (per plan.md Structure Decision), `src`-layout:
`agent-service/src/agent_service/`, `agent-service/tests/`.

---

## Phase 1: Setup

**Purpose**: Get a real Python project scaffolded — there is none yet, this is the first
Python code in the repo.

- [X] T001 Initialize `agent-service/` with `uv init`; write `pyproject.toml` with the
  exact pinned dependencies from research.md §2 (`fastapi==0.141.1`,
  `langgraph==1.2.10`, `langchain-core==1.5.3`, `langchain-openai==1.4.1`,
  `langsmith==0.10.15`) plus dev dependencies (`ruff`, `mypy`, `pytest`); configure
  `ruff` (lint + format) and `mypy` (strict-ish type checking) in `pyproject.toml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared building blocks both LLM nodes depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 [P] Define Pydantic schemas in
  `agent-service/src/agent_service/schemas.py`: the `/extract` request model, the
  `ExtractSufficient`/`ExtractInsufficient` response models (matching
  `specs/003-jd-extraction-nestjs-integration/contracts/agent-orchestration.yaml`
  exactly, FR-006), and the LangGraph state model (depends on T001)
- [ ] T003 [P] Construct the shared `ChatOpenAI` client in
  `agent-service/src/agent_service/llm.py` with `timeout=20`, `max_retries=2`
  (research.md §4) — no LangSmith code needed, tracing activates purely via env vars
  (research.md §5) (depends on T001)

**Checkpoint**: Foundation ready — node implementation can begin

---

## Phase 3: User Story 1 - Fulfill the agent orchestration contract for the NestJS service (Priority: P1) 🎯 MVP

**Goal**: `POST /extract` accepts JD text, runs it through the two-node LangGraph graph,
and returns a response matching the pre-existing contract exactly — sufficient path with
extraction + 0-6 directions, insufficient path with a reason, both schema-validated
twice over (spec.md Acceptance Scenarios 1-4).

**Independent Test**: See spec.md's Independent Test — send JD text to `POST /extract`
directly and check the response shape; this feature is testable entirely on its own,
without the NestJS service.

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they FAIL before the corresponding implementation task.

- [ ] T004 [P] [US1] Unit tests for `extract_jd_structure` in
  `agent-service/tests/unit/test_extract_jd_structure.py` — mock the `ChatOpenAI` call;
  cover the sufficient and insufficient branches and that a schema-violating mock
  response is rejected, not passed through (FR-002, FR-005)
- [ ] T005 [P] [US1] Unit tests for `generate_candidate_directions` in
  `agent-service/tests/unit/test_generate_candidate_directions.py` — mock the
  `ChatOpenAI` call; cover the 0-6 direction count bound and schema validation (FR-003,
  FR-005)
- [ ] T006 [US1] Contract test for `POST /extract` in
  `agent-service/tests/contract/test_extract_endpoint.py` using FastAPI's `TestClient` —
  mock the graph's LLM calls; assert the sufficient (200), insufficient (200), and
  invalid-request (4xx, no LLM call made) response shapes against
  `contracts/agent-orchestration.yaml` (FR-001, FR-004, FR-006, FR-007)

### Implementation for User Story 1

- [ ] T007 [P] [US1] Implement `extract_jd_structure` in
  `agent-service/src/agent_service/nodes.py` — `ChatPromptTemplate` + LCEL +
  `llm.with_structured_output(Schema, method="json_schema", include_raw=True)`, plus the
  explicit re-validation step before returning the state update (research.md §3)
  (depends on T002, T003; must satisfy T004)
- [ ] T008 [P] [US1] Implement `generate_candidate_directions` in
  `agent-service/src/agent_service/nodes.py` — same LangChain pattern as T007, input =
  structured extraction + the full original JD text (not a summary) (depends on T002,
  T003; must satisfy T005)
- [ ] T009 [US1] Wire the `StateGraph` in `agent-service/src/agent_service/graph.py`:
  `extract_jd_structure` → conditional edge on `sufficient` → `reject_input` (trivial
  terminal node, no LLM call) or `generate_candidate_directions`, both reaching `END`;
  compile once at module load (depends on T007, T008)
- [ ] T010 [US1] Implement the FastAPI app and `POST /extract` endpoint in
  `agent-service/src/agent_service/main.py` — invokes the compiled graph synchronously,
  maps graph state to the `ExtractSufficient`/`ExtractInsufficient` response models via
  FastAPI's `response_model` (second validation layer, research.md §3) (depends on T009;
  must satisfy T006)

**Checkpoint**: User Story 1 is independently testable — `uv run uvicorn
agent_service.main:app` + curl per quickstart.md §1-§3.

---

## Final Phase: Polish & Cross-Cutting Concerns

- [ ] T011 [P] Manually run quickstart.md's scenarios end-to-end (§1-§4 against this
  service alone with a real `OPENAI_API_KEY`; §5 the full NestJS→Python→OpenAI→Postgres
  pipeline, using the `jobpilot-postgres` container from SCRUM-38/39; §6 automated
  tests + lint + typecheck) — §5 is the first time this full chain has ever completed
  (SC-004)
- [ ] T012 Request an independent review of the tests added in T004-T006 from the
  `test-reviewer` subagent (Constitution V)
- [ ] T013 [P] Offer to generate a learning note before closing out (CLAUDE.md
  Workflow) — first Python code in the project; likely candidates: LangGraph+LangChain
  node patterns, `uv`/`ruff` tooling, LangSmith zero-code tracing

---

## Dependencies & Execution Order

- **Setup (T001)**: No dependencies
- **Foundational (T002, T003)**: Depend on T001, no dependency on each other — parallel
- **User Story 1 tests (T004-T006)**: T004/T005 depend on nothing but can only be
  meaningfully written once the schemas they assert against (T002) exist conceptually;
  T006 similarly. All three can be written in parallel with each other.
- **User Story 1 implementation (T007-T010)**: T007/T008 depend on T002+T003, parallel
  with each other; T009 depends on both; T010 depends on T009
- **Polish (T011-T013)**: Depend on T001-T010 being complete

## Notes

- [P] tasks touch different files with no dependency on an incomplete task
- Verify T004-T006 fail before implementing T007-T010
- Commit after each task or logical group
