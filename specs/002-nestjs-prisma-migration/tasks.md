# Tasks: NestJS + Prisma API Migration

**Input**: Design documents from `/specs/002-nestjs-prisma-migration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml, quickstart.md

**Tests**: Included. Constitution Principle V (Definition of Done) requires a corresponding test for new logic — a governance requirement, not optional for this feature. Per this project's existing convention (see specs/001-jd-training-directions), automated tests mock external state (here: the Prisma-managed DB connection); actual schema/migration correctness is verified manually via quickstart.md, not via a Jest integration test against a real database.

**Task granularity**: Coarser than the Spec Kit default per CLAUDE.md/`.claude/skills/speckit-tasks/SKILL.md`'s task-granularity practice — tasks only collapse when they're the same kind of work in the same functional area AND have no ordering dependency; a different functional area (e.g. schema/migration vs. service code) stays split even without a dependency.

**Organization**: Tasks are grouped by user story (US1/US2/US3 from spec.md), all P1-P3 priority. Per spec.md, US1 and US2 have no dependency on each other once Foundational is done — both depend only on the NestJS bootstrap.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps the task to US1/US2/US3 (Setup/Foundational/Polish carry no story label)

## Path Conventions

Single project (per plan.md Structure Decision): `src/`, `tests/`, `prisma/` at the repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get the repository buildable against the new stack before anything else.

- [X] T001 Add NestJS + Prisma dependencies to `package.json` (`@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `reflect-metadata`, `rxjs`; dev: `prisma`, `@nestjs/testing`; keep `zod`), remove `fastify`, `drizzle-orm`, `drizzle-kit`, and enable `"experimentalDecorators": true` + `"emitDecoratorMetadata": true` in `tsconfig.json` (research.md §1, §2, §3)
- [X] T002 Scaffold Prisma: `npx prisma init` to create `prisma/schema.prisma` + a `DATABASE_URL` entry; enable the `postgresqlExtensions` preview feature and declare the `vector` extension on the datasource block (research.md §4) (depends on T001)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before either user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 Create the NestJS bootstrap: `src/main.ts` (`NestFactory.create` with the Express platform adapter, `listen()`) and an empty root `src/app.module.ts` (depends on T001)

**Checkpoint**: Foundation ready — User Story 1 and User Story 2 can now proceed in parallel with each other (neither depends on the other; both only need T003)

---

## Phase 3: User Story 1 - Start the API service on the approved framework (Priority: P1) 🎯 MVP

**Goal**: A running NestJS application with a health-check endpoint, replacing Fastify.

**Independent Test**: Run the dev command; `GET /health` returns a successful response (spec.md Acceptance Scenarios 1-2).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they FAIL before the corresponding implementation task.

- [X] T004 [P] [US1] Write tests for the health endpoint: unit test for `HealthController` in `tests/unit/health/health.controller.test.ts`, and a contract test for `GET /health` against `contracts/openapi.yaml` in `tests/contract/health.contract.test.ts`

### Implementation for User Story 1

- [X] T005 [US1] Implement `HealthModule` + `HealthController` (`GET /health` → `{"status":"ok"}`) in `src/health/health.module.ts` and `src/health/health.controller.ts`, and register `HealthModule` in `src/app.module.ts` (depends on T003; must satisfy T004)

**Checkpoint**: User Story 1 is independently testable — `npm run dev` + `curl localhost:3000/health` per quickstart.md §2.

---

## Phase 4: User Story 2 - Persist existing data entities through the approved ORM (Priority: P2)

**Goal**: The two SCRUM-3 entities (`JdSubmission`, `CandidateTrainingDirection`) re-expressed in Prisma with an equivalent migration, pgvector enabled, and an injectable `PrismaService` future features can build on.

**Independent Test**: Apply the migration to a fresh database and confirm it matches data-model.md (spec.md Acceptance Scenarios 1-3; verified via quickstart.md §1, not an automated test — see Tests note above).

### Tests for User Story 2 ⚠️

- [ ] T006 [P] [US2] Write a unit test for `PrismaService`'s connection lifecycle (`onModuleInit`/`onModuleDestroy`) in `tests/unit/prisma/prisma.service.test.ts`

### Implementation for User Story 2

- [ ] T007 [US2] Define the Prisma schema for `JdSubmission` and `CandidateTrainingDirection` in `prisma/schema.prisma` per data-model.md's field/constraint tables, generate the migration with `npx prisma migrate dev`, and hand-add the two CHECK constraints (`jd_submissions_status_check`, `candidate_training_directions_question_count_check`) to the generated migration SQL (depends on T002)
- [ ] T008 [US2] Implement `PrismaModule` + `PrismaService` (extends `PrismaClient`, wired to NestJS's module lifecycle) in `src/prisma/prisma.module.ts` and `src/prisma/prisma.service.ts`, and register `PrismaModule` in `src/app.module.ts` (depends on T003; must satisfy T006)

**Checkpoint**: User Story 2 is independently testable — `npx prisma migrate dev` against a fresh DB, verified per quickstart.md §1.

---

## Phase 5: User Story 3 - Keep the quality gate green through the migration (Priority: P3)

**Goal**: Zero Fastify/Drizzle remnants; typecheck/lint/test all pass.

**Independent Test**: Run typecheck/lint/test; grep the codebase and dependency manifest for Fastify/Drizzle references (spec.md Acceptance Scenarios 1-2; quickstart.md §3).

- [ ] T009 [US3] Remove the old Fastify/Drizzle code: delete `src/db/` (`schema.ts`, `client.ts`, `migrations/`, `repositories/`), `drizzle.config.ts`, and the unused `src/routes/` placeholder (depends on T005, T008 — both new equivalents must exist first)
- [ ] T010 [US3] Run `npm run typecheck && npm run lint && npm run test` and fix any failures; confirm no `fastify`/`drizzle` references remain in `package.json` or `src/` (FR-006, FR-007, SC-003) (depends on T009)

**Checkpoint**: All three user stories complete — this is the whole feature (foundation only, no business endpoints per spec.md Assumptions).

---

## Final Phase: Polish & Cross-Cutting Concerns

- [ ] T011 [P] Manually run quickstart.md's three validation scenarios end-to-end against a running `npm run dev` server
- [ ] T012 Request an independent review of the tests added in T004/T006 from the `test-reviewer` subagent (Constitution V — avoid the implementer grading their own tests)
- [ ] T013 [P] If implementation surfaced a new technical pattern or pitfall (e.g. NestJS+ESM decorator metadata, enabling pgvector via Prisma), offer to generate a learning note before closing out (CLAUDE.md Workflow)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T002 depends on T001 within this phase
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS both User Story 1 and User Story 2
- **User Story 1 (Phase 3)** and **User Story 2 (Phase 4)**: Both depend only on Foundational completion — independent of each other, can proceed in parallel
- **User Story 3 (Phase 5)**: Depends on both US1 and US2 being done (T009 removes the old code only once both new equivalents exist)
- **Polish (Final Phase)**: Depends on User Story 3 being complete

### Parallel Opportunities

- T004 (US1 tests) and T006 (US2 tests) can run in parallel with each other — different components, no dependency
- Once Foundational (T003) is done, all of US1 (T004-T005) and US2 (T006-T008) can proceed in parallel as two independent tracks
- T011 and T013 in Polish can run in parallel with each other

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 (Setup) + Phase 2 (Foundational)
2. Complete Phase 3 (User Story 1) — a running, health-checkable NestJS service is the smallest useful checkpoint
3. Complete Phase 4 (User Story 2) — Prisma persistence layer in place
4. Complete Phase 5 (User Story 3) — old stack removed, quality gate green
5. Complete Polish, then this feature is done

### Notes

- [P] tasks touch different files with no dependency on an incomplete task
- [US1]/[US2]/[US3] labels map a task to its user story for traceability
- Verify tests fail before implementing (T004 before T005, T006 before T008)
- Commit after each task or logical group
- Avoid: vague tasks, same-file conflicts
