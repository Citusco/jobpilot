# Tasks: JD Structured Extraction and Candidate Training Direction Recommendation (NestJS Integration)

**Input**: Design documents from `/specs/003-jd-extraction-nestjs-integration/`

**Prerequisites**: plan.md, spec.md, research.md, contracts/openapi.yaml, contracts/agent-orchestration.yaml, quickstart.md

**Tests**: Included. Constitution Principle V requires a corresponding test for new logic — not optional for this project.

**Task granularity**: Per CLAUDE.md/`.claude/skills/speckit-tasks/SKILL.md`'s task-granularity practice — two tasks collapse only when they're the same kind of work in the same functional area AND have no ordering dependency.

**Organization**: Single user story (P1), same as specs/001 — this is the entire feature scope. No Setup or Foundational phase is needed: this feature adds zero new npm dependencies (research.md §1) and reuses the Prisma/NestJS foundation from specs/002 unchanged.

## Format: `[ID] [P?] [Story] Description`

## Path Conventions

Single project (per plan.md Structure Decision): `src/`, `tests/` at the repository root.

---

## Phase 1: User Story 1 - Extract JD structural information and generate candidate training directions (Priority: P1) 🎯 MVP

**Goal**: `POST /jd-submissions` validates the request, calls the agent orchestration service, persists the result, and returns a response identical to specs/001's public contract — with correct behavior for the accepted/rejected/upstream-failure/invalid-request paths (spec.md Acceptance Scenarios 1-4).

**Independent Test**: See spec.md's Independent Test note — Acceptance Scenarios 3-4 (upstream failure, invalid request) and persistence logic are fully verifiable now via quickstart.md §2-4; Scenarios 1-2 (happy/rejection path) require the agent orchestration service to exist.

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they FAIL before the corresponding implementation task.

- [X] T001 [P] [US1] Unit tests for `AgentOrchestrationClient` in `tests/unit/agent-orchestration/agent-orchestration.client.test.ts` — covers: successful call returns validated response, network error is mapped to the client's failure type, timeout (AbortController firing) is mapped to the same failure type, a response that fails `ExtractResponseSchema` validation is also mapped to that failure type (not silently passed through) (FR-002, FR-005, research.md §2/§4)
- [X] T002 [P] [US1] Unit tests for `JdSubmissionsService` in `tests/unit/jd-submissions/jd-submissions.service.test.ts` (agent client and `PrismaService` both mocked) — covers: sufficient result persists `JdSubmission` (status `accepted`) + all `CandidateTrainingDirection` rows and returns the mapped accepted DTO (FR-003); insufficient result persists `JdSubmission` (status `rejected`) with no directions and returns the rejected DTO (FR-004); agent-client failure persists nothing and throws/returns the upstream-failure case (FR-005)
- [X] T003 [US1] Contract test for `POST /jd-submissions` in `tests/contract/jd-submissions.contract.test.ts` — boots `AppModule` with `AgentOrchestrationClient` mocked (same pattern as `tests/contract/health.contract.test.ts`'s `PrismaService` override); asserts all four response shapes against `contracts/openapi.yaml`: `201` (accepted), `422` (rejected), `400` (invalid body — no call made to the agent client, confirms FR-006), `502` (agent client failure)

### Implementation for User Story 1

- [X] T004 [P] [US1] Define the two Zod schemas: `ExtractResponseSchema` (both `sufficient: true`/`false` shapes per `contracts/agent-orchestration.yaml`) in `src/agent-orchestration/schemas/extract-response.schema.ts`, and the public request schema (`{ text: string, minLength 1 }`) in `src/jd-submissions/schemas/jd-submission-request.schema.ts`
- [X] T005 [US1] Implement `AgentOrchestrationClient` + `AgentOrchestrationModule` in `src/agent-orchestration/agent-orchestration.client.ts` and `agent-orchestration.module.ts` — `fetch` to `${AGENT_SERVICE_URL}/extract` (env var, default `http://localhost:8000` for local dev), 30s `AbortController` timeout, validates the response with T004's `ExtractResponseSchema` before returning it (depends on T004; must satisfy T001)
- [X] T006 [US1] Implement `JdSubmissionsController` + `JdSubmissionsService` + `JdSubmissionsModule` in `src/jd-submissions/` — controller validates the request body with T004's request schema (400 on failure), service calls T005's `AgentOrchestrationClient`, persists via the existing `PrismaService` (specs/002) per FR-003/FR-004, maps to the `201`/`422`/`502` response shapes; registers both `AgentOrchestrationModule` and `JdSubmissionsModule` in `src/app.module.ts` (depends on T004, T005; must satisfy T002, T003)

**Checkpoint**: User Story 1 is independently testable per its Independent Test note — quickstart.md §2-4 runnable now, §1 pending the agent orchestration service.

---

## Final Phase: Polish & Cross-Cutting Concerns

- [X] T007 [P] Manually run quickstart.md's runnable scenarios (§2 invalid request, §3 upstream failure with `AGENT_SERVICE_URL` pointing nowhere, §4 automated tests) against a running `npm run dev` server; confirm no `jd_submissions` row is written on §3 via `psql`. **Found and fixed a real bug in the process**: the first run returned 500 instead of 502 — `tsx` (esbuild) never emits TypeScript's `design:paramtypes` decorator metadata, so NestJS silently failed to inject `JdSubmissionsService` into `JdSubmissionsController` at runtime, even though all 17 automated tests passed (`ts-jest` uses real `tsc`, which emits the metadata correctly — masking the bug). This is a foundational issue dating back to SCRUM-38 that only surfaced now because this is the first feature with a real constructor-injected dependency. Fixed by switching `npm run dev` to `node --watch --import ./scripts/register-ts-node.mjs src/main.ts` (`ts-node`'s ESM loader); `tsx` removed from `package.json` entirely. Re-verified: §2/§3 both now return the correct status codes, zero rows persisted on §3, and `node --watch` restart still works. See `specs/002-nestjs-prisma-migration/research.md` §1 (marked superseded) and the Obsidian note `jobpilot-nestjs-esm-tooling-pitfalls.md` for the full writeup.
- [ ] T008 Request an independent review of the tests added in T001-T003 from the `test-reviewer` subagent (Constitution V)
- [ ] T009 [P] If implementation surfaced a new technical pattern or pitfall (e.g. contract-first development against a service that doesn't exist yet, `AbortController` timeout patterns), offer to generate a learning note before closing out (CLAUDE.md Workflow)

---

## Dependencies & Execution Order

- **T001, T002**: No dependencies — can start immediately, in parallel with each other
- **T003**: No dependencies on T001/T002 to *write* (TDD — write first, confirm it fails), but exercises the same code T004-T006 implement
- **T004**: No dependencies — can start immediately, in parallel with T001-T003
- **T005**: Depends on T004 (needs `ExtractResponseSchema`)
- **T006**: Depends on T004, T005 (needs both schemas and the client)
- **Polish (T007-T009)**: Depends on T001-T006 being complete

## Notes

- No Setup/Foundational phase — see Organization above for why
- Verify T001-T003 fail before implementing T004-T006
- Commit after each task or logical group
