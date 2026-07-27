<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0
Rationale: MINOR — materially expands/refines existing guidance without
removing or redefining a principle. The process was found too heavy in
practice (duplicated tracking across Jira, Git, and Spec Kit at per-task
granularity); this amendment collapses that to feature-level tracking and
introduces a two-tier workflow (lightweight default vs. full SDD for
structural changes), which Principle III already gestured at but did not
fully specify.

Modified principles:
  - III. Plan-Before-Build for Structural Changes — trigger list now
    explicitly names RAG/retrieval architecture and Judge0 sandbox security
    boundaries alongside the existing DB schema / LangGraph topology / cloud
    infrastructure triggers, so the boundary of "needs full SDD" is
    unambiguous.
  - V. Definition of Done: Typed, Tested, Reviewed — expanded to explicitly
    list acceptance-criteria satisfaction, design-decision documentation, PR
    completion, and Jira Story update as done-criteria (previously implied
    but not enumerated).

Added sections: none new — "Development Workflow" section rewritten in place.

Removed sections: none.

Rewritten sections:
  - Development Workflow (Spec-Driven Development) — replaced the flat
    "always run the core loop for big changes" description with: (1) one
    feature = one Jira Story = one feature branch = one PR, (2) Jira sync
    only at feature start/finish, not per task, (3) tasks.md checklist items
    are internal only — no per-task Jira subtasks/branches/PRs, (4) default
    workflow is Explore → Short Plan → Implement → Typecheck/Lint/Test → PR,
    (5) full SDD (`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
    `/speckit-implement`) reserved for Principle III triggers, (6)
    `/speckit-clarify`, `/speckit-analyze`, `/speckit-converge` are optional
    on-demand tools, not part of either default path, (7) `/speckit-checklist`
    and `/speckit-taskstoissues` are excluded from the default workflow
    entirely, (8) default artifact set per feature is spec.md + plan.md +
    tasks.md only — research.md/data-model.md/quickstart.md/openapi.yaml
    generated only when the feature genuinely needs them.

Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (Constitution
    Check gate is generic/dynamic)
  - .specify/templates/spec-template.md ✅ no change needed
  - .specify/templates/tasks-template.md ✅ no change needed (no Jira
    references in the template itself; the per-task Jira mapping that
    appeared in specs/001-jd-training-directions/tasks.md was ad hoc, not
    template-driven, and has been annotated as historical)
  - .claude/skills/speckit-implement/SKILL.md ⚠️ updated — replaced
    per-task Jira/branch requirements with feature-level equivalents
  - .claude/skills/speckit-specify/SKILL.md ⚠️ updated — added Jira Story
    creation at feature start
  - .claude/skills/speckit-plan/SKILL.md ⚠️ updated — research.md/
    data-model.md/contracts/quickstart.md generation now conditional
  - CLAUDE.md ⚠️ updated to match (see this file's Governance section)

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

Any task that changes one or more of the following MUST go through the full
Spec-Driven Development flow — `/speckit-specify` → `/speckit-plan` →
`/speckit-tasks` → `/speckit-implement` — before implementation begins.
Jumping straight to code for these categories of change is NOT permitted:

- Database schema (new tables, columns, or relationships)
- LangGraph state graph topology (new nodes, edges, or state shape changes)
- RAG/retrieval architecture (pgvector index design, chunking strategy,
  retrieval/ranking approach)
- Cloud infrastructure (S3, EventBridge, Lambda, Step Functions, DynamoDB)
- Judge0 sandbox security boundaries (execution isolation, resource limits,
  network access controls)

Everything else uses the lightweight default workflow (see Development
Workflow below) — routing a change through the full SDD flow when it isn't
needed is itself a process failure, not a safe default.

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

A feature is done only when ALL of the following hold:

- The spec's acceptance criteria are satisfied
- New logic has corresponding tests — untested new logic does not count as
  done
- Typecheck, lint, and the full test suite all pass
- Important design decisions made along the way are documented (in the
  PR description, plan.md, or a code comment, as appropriate — not left
  implicit)
- The PR is completed (opened, and — for full-SDD features — reviewed)
- The feature's Jira Story is updated to reflect current status

Code MUST use ES modules (`import`/`export`); CommonJS MUST NOT be
introduced. Tests covering new logic SHOULD be reviewed by the
`test-reviewer` subagent independently of the implementer, rather than
self-graded by whoever wrote the implementation.

**Rationale**: An implementer grading their own tests is prone to
confirmation bias — independent review catches gaps the author is blind to.
Consistent module format and passing quality gates keep the codebase
mechanically consistent as it grows.

## Development Workflow

**One feature = one Jira Story = one feature branch = one PR.** This
mapping is fixed and MUST NOT be subdivided — a feature's internal task
breakdown (tasks.md, if one exists) does not create additional Jira issues,
branches, or PRs. Jira is synchronized exactly twice per feature: when work
starts (Story → In Progress) and when it finishes (Story → In Review/Done).
Intermediate task-level progress lives in tasks.md and git commits, not in
Jira status changes.

### Default workflow (most work)

`Explore → Short Plan → Implement → Typecheck/Lint/Test → PR`

No Spec Kit artifacts are required for this path. Use judgment on how much
up-front planning a short plan needs — for most changes a few sentences in
the PR description or a short message to the user before implementing is
enough.

### Full SDD workflow (Principle III triggers only)

`/speckit-specify → /speckit-plan → /speckit-tasks → /speckit-implement`

- `/speckit-specify` creates the feature directory, the feature branch, and
  the feature's single Jira Story (transitioned to In Progress).
- `/speckit-plan` generates spec.md, plan.md, and tasks.md by default.
  research.md, data-model.md, contracts/ (openapi.yaml), and quickstart.md
  are generated only when the feature genuinely needs them (e.g. research.md
  only if there are real unresolved technology choices; data-model.md only
  if new entities/schema are introduced; contracts/ only if a new external
  interface is exposed; quickstart.md only if a runnable validation guide
  adds value beyond the spec's acceptance scenarios) — skipping an artifact
  that isn't needed is the expected default, not a shortcut.
- `/speckit-tasks` produces tasks.md as an **internal implementation
  checklist only**. Task IDs (T001, T002, ...) are not tracked in Jira.
- `/speckit-implement` executes all tasks continuously on the single feature
  branch created by `/speckit-specify` — it does not create branches, push,
  or touch Jira per task. When the whole feature (or the user's requested
  stopping point) is done, it pushes once and opens the single PR, and the
  Jira Story is transitioned once.
- `/speckit-clarify`, `/speckit-analyze`, and `/speckit-converge` are
  optional, on-demand tools usable at any point in either workflow when
  their specific function is needed — they are not required steps in either
  path.
- `/speckit-checklist` and `/speckit-taskstoissues` are excluded from both
  default workflows; invoke them directly only if their specific output is
  wanted for a one-off reason.

### Both workflows

- Direct commits to `main` for feature work are NOT permitted.
- A feature is complete only once typecheck, lint, and test all pass
  (Principle V).
- If a feature surfaces a new technical pattern or a notable pitfall, the
  implementer should offer to generate a learning note before closing out.
- The `ticket-wrapup` skill runs once per feature, before the Jira Story is
  marked Done — not once per tasks.md task.

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

**Version**: 1.1.0 | **Ratified**: 2026-07-27 | **Last Amended**: 2026-07-27
