# Implementation Plan: JD Structured Extraction and Candidate Training Direction Recommendation (NestJS Integration)

**Branch**: `scrum-39-jd-extraction-nestjs-integration` | **Date**: 2026-08-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-jd-extraction-nestjs-integration/spec.md`

## Summary

Implement `POST /jd-submissions` on the NestJS API service: validate the incoming JD
text, call the (not-yet-built) Python agent orchestration service over a newly-defined
HTTP contract, validate its response, persist the result via the existing Prisma schema
from SCRUM-38, and return a response byte-identical to specs/001's original public
contract. Zero new npm dependencies — the outbound call uses Node's native `fetch`
(research.md §1). End-to-end verification of the happy/rejection paths is blocked on the
agent orchestration service existing; everything else (request validation, persistence,
upstream-failure handling) is fully implementable and testable now.

## Technical Context

**Language/Version**: TypeScript (Node.js >=20, ESM) — same as specs/002, no change

**Primary Dependencies**: `@nestjs/common`, `@nestjs/core` (existing), `zod` (existing),
Node's native `fetch`/`AbortController` (built-in, no new package). No new runtime
dependencies added by this feature.

**Storage**: Existing Prisma schema from specs/002-nestjs-prisma-migration — no schema
changes; this feature only writes through `PrismaService`.

**Testing**: Jest (existing config), agent-service HTTP call mocked in all automated
tests (research.md §4)

**Target Platform**: Linux server (Node.js backend), same service as specs/002

**Project Type**: Extends the existing single NestJS project — no new services or
projects created by this feature (the actual Python agent orchestration service is out
of scope; a future feature)

**Performance Goals**: 30-second bound on the agent-service call (research.md §2); no
other stated performance requirement

**Constraints**: Zero persisted records on any upstream failure path (FR-005/SC-003);
public HTTP contract must remain identical to specs/001's (FR-008)

**Scale/Scope**: One new public endpoint (`POST /jd-submissions`), one new internal HTTP
contract (`POST /extract` on the agent orchestration service, not implemented by this
feature), two new NestJS feature modules (`AgentOrchestrationModule`,
`JdSubmissionsModule`). Reuses existing Prisma entities and `PrismaService` untouched.

No `NEEDS CLARIFICATION` markers remain.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Schema-Validated LLM I/O**: Applies at one remove — this feature doesn't call an
  LLM directly, but it does receive data that originated from one, crossing the service
  boundary from the agent orchestration service. A Zod schema
  (`contracts/agent-orchestration.yaml` → `ExtractResponseSchema`) validates that
  response before any of it is used or persisted; a second Zod schema validates the
  public request body. PASS, with both schemas implemented as part of this feature's
  tasks.
- **II. Independently Testable LangGraph Nodes**: N/A — no LangGraph nodes exist in this
  feature; that logic lives entirely in the (not-yet-built) Python service. PASS.
- **III. Plan-Before-Build for Structural Changes**: This feature defines the
  NestJS↔Python service-boundary contract for the first time — exactly the trigger
  added to Principle III during the v2.0.0 amendment. Confirms Full SDD is the correct
  workflow already in use. PASS.
- **IV. Locked Technology Stack**: No new dependency introduced — native `fetch` was
  chosen specifically over `@nestjs/axios`/`axios` to avoid an undiscussed addition
  (research.md §1). PASS.
- **V. Definition of Done**: ES modules maintained; new logic (Zod schemas, the agent
  client, the JD-submissions service/controller) requires tests per Definition of Done;
  typecheck/lint/test must pass; tests reviewed by `test-reviewer` at implementation
  time, same practice as specs/002. PASS.

No violations — Complexity Tracking table is not needed.

**Post-Phase-1 re-check**: research.md and the two contracts/ files don't introduce
anything beyond what Technical Context already covers. Still PASS on all five
principles.

## Project Structure

### Documentation (this feature)

```text
specs/003-jd-extraction-nestjs-integration/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   ├── openapi.yaml               # public contract (unchanged from specs/001, FR-008)
│   └── agent-orchestration.yaml   # NEW internal contract this feature authors
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

No data-model.md — this feature introduces no new entities or schema; it reuses
specs/002-nestjs-prisma-migration/data-model.md's `JdSubmission`/
`CandidateTrainingDirection` models unchanged.

### Source Code (repository root)

```text
src/
├── agent-orchestration/
│   ├── agent-orchestration.module.ts
│   ├── agent-orchestration.client.ts    # fetch wrapper: POST to AGENT_SERVICE_URL/extract,
│   │                                     # 30s AbortController timeout, Zod-validates response
│   └── schemas/
│       └── extract-response.schema.ts   # Zod schema for contracts/agent-orchestration.yaml's
│                                         # ExtractResponse (both sufficient/insufficient shapes)
├── jd-submissions/
│   ├── jd-submissions.module.ts
│   ├── jd-submissions.controller.ts     # POST /jd-submissions (FR-001)
│   ├── jd-submissions.service.ts        # validate request -> call agent client ->
│   │                                     # persist via PrismaService -> map to response DTO
│   └── schemas/
│       └── jd-submission-request.schema.ts   # Zod schema for {text: string} (FR-006)
├── app.module.ts                         # updated: imports AgentOrchestrationModule,
│                                          # JdSubmissionsModule
└── prisma/, health/                      # UNCHANGED, from specs/002

tests/
├── unit/agent-orchestration/agent-orchestration.client.test.ts   # timeout + error mapping
├── unit/jd-submissions/jd-submissions.service.test.ts            # persistence + rejection logic
└── contract/jd-submissions.contract.test.ts                      # full HTTP contract, agent
                                                                     # client mocked
```

**Structure Decision**: Extends the existing single-project layout from specs/002 — two
new sibling feature modules alongside `health/` and `prisma/`, following the same
module-per-concern pattern already established. No new backend/frontend split, no new
deployable unit (the actual Python agent orchestration service, when built, will be a
separate feature and likely a separate repository/deployable — out of scope here).

## Complexity Tracking

*No entries — Constitution Check has no violations to justify.*
