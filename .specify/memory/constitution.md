<!--
Sync Impact Report
==================
Version change: TEMPLATE (unfilled) → 1.0.0
Rationale: Initial ratification. All placeholder tokens replaced with concrete,
project-specific governance. This is the first substantive content, so MAJOR
version 1.0.0 per semantic versioning rules for initial adoption.

Modified principles: N/A (first fill, no prior titled principles existed)

Added sections:
  - Core Principles I–V (Schema-Validated LLM I/O; Independently Testable
    LangGraph Nodes; Plan-Before-Build for Structural Changes; Locked
    Technology Stack; Definition of Done: Typed, Tested, Reviewed)
  - Development Workflow (Spec-Driven Development)
  - Governance

Removed sections: none (template placeholders only)

Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (Constitution Check
    gate is already generic/dynamic, references "constitution file" not
    hardcoded principle names)
  - .specify/templates/spec-template.md ✅ no change needed (no
    constitution-specific references)
  - .specify/templates/tasks-template.md ✅ no change needed (task
    categorization is generic; testing-task guidance already compatible with
    Principle II and V)
  - .claude/skills/speckit-*/SKILL.md ✅ reviewed, no outdated agent-specific
    references found requiring change

Follow-up TODOs: none — no placeholders were deferred.
-->

# JobPilot Constitution

## Core Principles

### I. Schema-Validated LLM I/O (NON-NEGOTIABLE)

All LLM calls that return structured output MUST have a corresponding Zod
schema, and the response MUST be parsed/validated through that schema before
it is used anywhere downstream. Raw, unvalidated LLM output MUST NOT be
passed into application logic, persisted, or forwarded to another node.

**Rationale**: LLM output shape is not guaranteed by static typing alone —
providers can drift, prompts can be edited without updating call sites, and
malformed output must fail loudly at the boundary rather than corrupt state
further downstream.

### II. Independently Testable LangGraph Nodes

Every LangGraph node MUST be unit-testable in isolation from the rest of the
graph. Tests for node logic MUST mock the LLM call; unit tests MUST NOT make
real API calls to any LLM provider.

**Rationale**: Real API calls make tests slow, flaky, non-deterministic, and
costly to run in CI. Mocking the LLM boundary keeps node logic (routing,
state transitions, error handling) verifiable on its own merits.

### III. Plan-Before-Build for Structural Changes

Any task that changes database schema, LangGraph state graph design, or
cloud infrastructure (S3, EventBridge, Lambda, Step Functions, DynamoDB, or
the Judge0 sandbox setup) MUST go through the full Spec-Driven Development
flow — `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
`/speckit-implement` — before implementation begins. Jumping straight to
code for these categories of change is NOT permitted.

**Rationale**: These changes are expensive to reverse, have wide blast
radius (shared state, running pipelines, other features' data), and benefit
from upfront design review far more than they cost in process overhead.

### IV. Locked Technology Stack

The approved stack is: Node.js + TypeScript + Fastify (backend); LangGraph.js
(orchestration); pgvector on Postgres (vector store); AWS S3 + EventBridge +
Lambda + Step Functions + DynamoDB (data pipeline); self-hosted Judge0
(sandbox). LLM providers are called directly via their SDKs (OpenAI /
Bedrock) — no gateway indirection is required at this stage; routing through
a unified gateway (Agent Forge) is an explicitly deferred, independent future
migration, not a current requirement.

Introducing any library, service, or provider outside this list requires
discussion and explicit agreement before it is used — it MUST NOT be added
silently as part of an unrelated feature.

**Rationale**: A locked stack keeps an early-stage project coherent and
prevents dependency sprawl and premature abstraction (e.g., gateway
indirection) before the underlying business logic has proven itself.

### V. Definition of Done: Typed, Tested, Reviewed

Code MUST use ES modules (`import`/`export`); CommonJS MUST NOT be
introduced. A new feature is not complete until it has corresponding tests —
untested new logic does not count as done. Typecheck, lint, and the full
test suite MUST all pass before a task is considered finished. Tests
covering new logic SHOULD be reviewed by the `test-reviewer` subagent
independently of the implementer, rather than self-graded by whoever wrote
the implementation.

**Rationale**: An implementer grading their own tests is prone to
confirmation bias — independent review catches gaps the author is blind to.
Consistent module format and passing quality gates keep the codebase
mechanically consistent as it grows.

## Development Workflow (Spec-Driven Development)

This project is managed with GitHub Spec Kit. The core loop is:
`/speckit-constitution` (once) → `/speckit-specify` → `/speckit-plan` →
`/speckit-tasks` → `/speckit-implement`.

- Tasks involving database schema, LangGraph state graph design, or cloud
  resource changes MUST go through the full SDD loop (see Principle III).
- Small changes — style adjustments, log format tweaks, and similarly
  low-risk edits — MAY skip the full loop and go directly through
  Explore → Implement → Verify.
- Each spec maps to one feature branch and one PR. Direct commits to `main`
  for feature work are NOT permitted.
- A task is complete only once typecheck, lint, and test all pass (Principle
  V). If the task surfaces a new technical pattern or a notable pitfall, the
  implementer should offer to generate a learning note before closing out.

## Governance

This constitution supersedes any conflicting practice, informal convention,
or prior undocumented habit in this project. `CLAUDE.md` provides
supplementary day-to-day runtime guidance (commands, tech stack detail,
code style) and MUST stay consistent with this document; where the two
conflict, this constitution wins and `CLAUDE.md` MUST be updated to match.

**Amendment procedure**: Amendments are made by editing this file via the
`/speckit-constitution` workflow, which regenerates the Sync Impact Report,
checks dependent templates (`plan-template.md`, `spec-template.md`,
`tasks-template.md`) for consistency, and bumps the version.

**Versioning policy** (semantic versioning):
- **MAJOR**: Backward-incompatible governance changes — removing or
  redefining a principle.
- **MINOR**: Adding a new principle or materially expanding existing
  guidance.
- **PATCH**: Wording clarifications, typo fixes, non-semantic refinements.

**Compliance review**: Every plan produced by `/speckit-plan` MUST pass the
Constitution Check gate against the principles above before Phase 0 research
begins, and MUST be re-checked after Phase 1 design. Any violation MUST be
justified in that plan's Complexity Tracking table or the simpler
alternative MUST be adopted instead.

**Version**: 1.0.0 | **Ratified**: 2026-07-27 | **Last Amended**: 2026-07-27
