<!--
Sync Impact Report
==================
Version change: 2.1.0 → 3.0.0
Rationale: MAJOR — Principle III and Principle IV are both redefined (not just
expanded), removing Judge0 from the project entirely: coding/live-coding questions
have been abandoned in favor of concept/decision questions with verbatim-sourced
grounding (see docs/DESIGN.md §1, §14, produced via a separate ~15-round design
session and now the project's source of truth for design decisions). This is a
backward-incompatible reduction of the approved stack and of Principle III's
trigger list, following the same amendment-required precedent already established
for stack changes (see the 2.0.0 report below).

Modified principles:
  - III. Plan-Before-Build for Structural Changes — the Full-SDD trigger list loses
    the "Judge0 sandbox security boundaries (execution isolation, resource limits,
    network access controls)" entry. No other trigger changed.
  - IV. Locked Technology Stack — the "**Sandbox** (unchanged): self-hosted Judge0"
    bullet is removed entirely. LangChain's presence in the agent orchestration
    service bullet is intentionally untouched by this amendment — DESIGN.md's
    §4.5 "no LangChain for the new pipeline" stance is scoped to new work only and
    does not reverse this already-agreed (2026-08-02) locked-stack decision; see
    docs/DECISIONS.md for the explicit reconciliation between the two.

Added sections: none new.

Removed sections: none (bullets removed within existing principles, not whole
sections).

Rationale for the removal: code questions were explored and deliberately
abandoned — "too shallow to matter, too deep to be tractable" — which removes the
only reason Judge0-based execution was in the stack. Recorded per Principle IV's
"requires discussion and explicit agreement" clause; discussed and agreed with the
user as part of adopting docs/DESIGN.md as the new design source of truth.

Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (no Judge0 reference
    found)
  - .specify/templates/spec-template.md ✅ no change needed (no Judge0 reference
    found)
  - .specify/templates/tasks-template.md ✅ no change needed (no Judge0 reference
    found)
  - .claude/skills/speckit-* ✅ checked — no hardcoded Judge0 references found
  - CLAUDE.md ✅ already updated (in the same session, before this amendment) —
    the "Sandbox: Judge0" tech-stack line and the "Judge0 security-boundary
    changes" Full-SDD trigger were both removed by hand; this amendment's
    constitution edits match what CLAUDE.md already reflects
  - README.md ⚠ pending — still references Judge0 (title framing as a
    "live-coding training content generator," and a "Judge0-sandboxed code
    execution" line in the Project Status checklist). Deliberately NOT updated in
    this pass — flagged as a follow-up, out of scope for this amendment
  - specs/001-jd-training-directions/*, specs/002-nestjs-prisma-migration/*,
    specs/003-jd-extraction-nestjs-integration/*, specs/004-python-agent-
    orchestration/* — intentionally NOT updated; historical artifacts documenting
    decisions made under the stack as it stood at the time, not current guidance

Follow-up TODOs: README.md's Judge0/live-coding references (see above).

Deferred non-governance intents (see Next Actions in the command output):
  - Adopting docs/DESIGN.md's actual pipeline/data-model design (concept and
    doc_chunk tables, the eight-step extract/resolve/combine/retrieve/generate/
    verify pipeline, LangGraph topology) is future implementation work, not part
    of this governance amendment — it will need its own Full-SDD feature(s) per
    Principle III once scoped.
-->

<!--
Sync Impact Report (previous amendment, retained for history)
==================
Version change: 2.0.0 → 2.1.0
Rationale: MINOR — Principle IV is expanded, not redefined: LangChain is added
alongside the already-locked LangGraph in the agent orchestration service, and
the "LLM providers called directly via their SDKs" wording is clarified (not
reversed) to state that LangChain's first-party integration packages satisfy
that requirement — "no gateway indirection" was always about routing/budget
layers like Agent Forge, not about client-side integration libraries. Nothing
already in the stack is removed or redefined.

Modified principles:
  - IV. Locked Technology Stack — agent orchestration service bullet now
    reads "Python + FastAPI + LangGraph + LangChain"; LLM-provider-calling
    paragraph reworded to describe calls going through LangChain's
    integration packages (which wrap the provider SDK directly) rather than
    a bare SDK call, with the "no gateway indirection" guarantee unchanged
    and now explicitly scoped to what it always meant.

Added sections: none new — Principle IV rewritten in place.

Removed sections: none.

Rationale for the addition (recorded per Principle IV's "requires discussion
and explicit agreement" clause): the same reasoning class already established
in this project for Drizzle over a bare `pg` driver
(specs/001-jd-training-directions/research.md §2) — deliberately chosen for
hands-on learning/resume value in a project explicitly optimized for that,
not because it's strictly required over calling `ChatOpenAI`'s underlying SDK
directly. Discussed and agreed with the user before this amendment.

Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (generic/dynamic)
  - .specify/templates/spec-template.md ✅ no change needed (technology-
    agnostic by design)
  - .specify/templates/tasks-template.md ✅ no change needed (no stack-
    specific references)
  - .claude/skills/speckit-* ✅ checked — no hardcoded references to the
    agent orchestration service's LLM-calling mechanism found
  - CLAUDE.md ⚠️ updated to match (see this file's Governance section)
  - specs/001-jd-training-directions/*, specs/002-nestjs-prisma-migration/*,
    specs/003-jd-extraction-nestjs-integration/* — intentionally NOT
    updated; historical artifacts documenting decisions made under the
    stack as it stood at the time, not current guidance

Follow-up TODOs: none — no placeholders were deferred.

Deferred non-governance intents (see Next Actions in the command output):
  - Run /speckit-specify for the actual Python FastAPI + LangGraph +
    LangChain agent orchestration service feature, using the architecture
    design already worked out (LangGraph for orchestration, LangChain for
    the LLM-calling primitives inside nodes) as the feature description
-->

<!--
Sync Impact Report (previous amendment, retained for history)
==================
Version change: 1.1.0 → 2.0.0
Rationale: MAJOR — Principle IV (Locked Technology Stack) is redefined, not
just expanded: the backend moves from a single Node.js/Fastify service to a
two-service split (Node.js/NestJS/Prisma for API + persistence, Python/
FastAPI/LangGraph for agent orchestration). This is a backward-incompatible
change to the approved stack and the project's structural shape, driven by a
new requirement to separate the API/persistence surface from the AI
orchestration surface so each can use the runtime best suited to it.

Modified principles:
  - I. Schema-Validated LLM I/O (NON-NEGOTIABLE) — validation requirement
    now specified per language: Pydantic models in the Python agent
    orchestration service, Zod schemas for structured data crossing back
    into the TypeScript API service. Previously assumed a single
    TypeScript/Zod codebase.
  - II. Independently Testable LangGraph Nodes — now explicitly scoped to
    the Python agent orchestration service, with pytest (not a JS test
    runner) as the required test tool and mocking mechanism named.
  - III. Plan-Before-Build for Structural Changes — trigger list gains a
    new entry: changes to the service boundary/contract between the NestJS
    API service and the Python agent orchestration service (or introduction
    of additional services). LangGraph topology trigger reworded to locate
    the graph in the Python service.
  - IV. Locked Technology Stack — redefined from a single-service Node.js/
    Fastify/LangGraph.js stack to a two-service split: NestJS + Prisma
    (API/persistence, Node.js/TypeScript) and FastAPI + LangGraph
    (agent orchestration, Python), connected by an explicit documented
    interface. Data pipeline (AWS) and sandbox (Judge0) are unchanged.
  - V. Definition of Done: Typed, Tested, Reviewed — the "ES modules, no
    CommonJS" rule is now scoped explicitly to the TypeScript/NestJS
    service, since the codebase is no longer single-language.

Added sections: none new — modified principles rewritten in place.

Removed sections: none.

Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no change needed (Constitution
    Check gate and Project Structure options are generic/dynamic; the
    existing "Option 2: Web application" pattern already accommodates a
    multi-service backend/frontend-style split, and /speckit-plan is
    expected to describe the NestJS/Python split concretely per feature)
  - .specify/templates/spec-template.md ✅ no change needed (technology-
    agnostic by design)
  - .specify/templates/tasks-template.md ✅ no change needed (path
    conventions are illustrative and adjusted per plan.md at generation
    time, no stack-specific references)
  - .claude/skills/speckit-plan, speckit-specify, speckit-implement, and
    other speckit-* skills ✅ checked — no hardcoded Fastify/Drizzle/
    LangGraph.js references found; nothing to update
  - CLAUDE.md ⚠️ updated to match (see this file's Governance section)
  - specs/001-jd-training-directions/* — intentionally NOT updated; these
    are historical artifacts of a feature built under the prior stack and
    document decisions made at that time, not current guidance

Follow-up TODOs: none — no placeholders were deferred.

Deferred non-governance intents (see Next Actions in the command output):
  - Splitting the actual stack migration into two Full-SDD features (NestJS
    + Prisma API migration, replacing SCRUM-3's already-merged Drizzle
    schema; Python FastAPI agent orchestration extraction)
-->

# JobPilot Constitution

## Core Principles

### I. Schema-Validated LLM I/O (NON-NEGOTIABLE)

All LLM calls that return structured output MUST have a corresponding schema
validated at the language boundary where the call is made, and the response
MUST be parsed/validated through that schema before it is used anywhere
downstream:

- In the Python agent orchestration service: a Pydantic model.
- In the TypeScript API service: a Zod schema, for any structured data that
  crosses the service boundary back from the agent orchestration service or
  is otherwise produced/consumed there.

Raw, unvalidated LLM output MUST NOT be passed into application logic,
persisted, or forwarded to another node or across the service boundary.

**Rationale**: LLM output shape is not guaranteed by static typing alone —
providers can drift, prompts can be edited without updating call sites, and
malformed output must fail loudly at the boundary rather than corrupt state
further downstream. This holds regardless of which language made the call.

### II. Independently Testable LangGraph Nodes

Every LangGraph node, implemented in the Python agent orchestration service,
MUST be unit-testable in isolation from the rest of the graph using pytest.
Tests for node logic MUST mock the LLM call (e.g., via `unittest.mock` or
`pytest-mock`); unit tests MUST NOT make real API calls to any LLM provider.

**Rationale**: Real API calls make tests slow, flaky, non-deterministic, and
costly to run in CI. Mocking the LLM boundary keeps node logic (routing,
state transitions, error handling) verifiable on its own merits.

### III. Plan-Before-Build for Structural Changes

Any task that changes one or more of the following MUST go through the full
Spec-Driven Development flow — `/speckit-specify` → `/speckit-plan` →
`/speckit-tasks` → `/speckit-implement` — before implementation begins.
Jumping straight to code for these categories of change is NOT permitted:

- Database schema (new tables, columns, or relationships)
- LangGraph state graph topology, in the Python agent orchestration service
  (new nodes, edges, or state shape changes)
- RAG/retrieval architecture (pgvector index design, chunking strategy,
  retrieval/ranking approach)
- Cloud infrastructure (S3, EventBridge, Lambda, Step Functions, DynamoDB)
- Service boundary or cross-language interface changes (new or modified
  contract between the NestJS API service and the Python agent
  orchestration service, or introduction of an additional service)

Everything else uses the lightweight default workflow (see Development
Workflow below) — routing a change through the full SDD flow when it isn't
needed is itself a process failure, not a safe default.

**Rationale**: These changes are expensive to reverse, have wide blast
radius (shared state, running pipelines, other features' data), and benefit
from upfront design review far more than they cost in process overhead.

### IV. Locked Technology Stack

The approved stack is split across two services with an explicit boundary
between them:

- **API & persistence service** — Node.js + TypeScript + NestJS, with
  Prisma as the ORM/migration tool for Postgres (including pgvector as the
  vector store on the same Postgres instance). Owns the public API surface,
  request/response contracts, and all persistent storage.
- **Agent orchestration service** — Python + FastAPI + LangGraph +
  LangChain. LangChain's first-party integration packages (e.g.
  `langchain-openai`) provide the LLM client, prompt-construction, and
  structured-output layer used *inside* LangGraph nodes; LangGraph remains
  the orchestration/state-graph layer. This is a separate deployable
  service, not a library imported into the API service.
- **Data pipeline** (unchanged): AWS S3 + EventBridge + Lambda + Step
  Functions + DynamoDB.

LLM providers are called via LangChain's first-party integration packages
(`langchain-openai`'s `ChatOpenAI` today; `langchain-aws` for Bedrock as a
documented future option) from the agent orchestration service. These
packages wrap the provider SDK directly and satisfy "no gateway
indirection" — the indirection that requirement guards against is a
routing/budget-management layer (Agent Forge), not a client-side
integration library; routing through a unified gateway remains an
explicitly deferred, independent future migration, not a current
requirement.

Communication between the two services MUST go through an explicit,
documented interface (e.g., an HTTP/REST contract). The services MUST NOT
share a database connection, in-process function call, or filesystem state
as an implicit coupling mechanism — the service boundary MUST be a
first-class, designed interface, not something discovered ad hoc.

Introducing any library, service, or provider outside this list requires
discussion and explicit agreement before it is used — it MUST NOT be added
silently as part of an unrelated feature.

**Rationale**: A locked stack keeps the project coherent and prevents
dependency sprawl and premature abstraction before the underlying business
logic has proven itself. Splitting API/persistence from agent orchestration
lets each side use the runtime best suited to its job — NestJS's structured
API conventions and Prisma's schema tooling for the request/persistence
surface, Python's native LangGraph and LangChain ecosystem for the agent
surface — at the cost of an explicit service boundary that must be
deliberately designed, which is why Principle III now treats changes to that
boundary as a structural change requiring full SDD. LangChain's addition
alongside LangGraph follows the same "deliberately chosen for hands-on
learning/resume value" reasoning already established for Drizzle over a
bare `pg` driver (specs/001-jd-training-directions/research.md §2) — this
project treats that as a legitimate tradeoff category, not scope creep,
as long as it's discussed and recorded rather than added silently.

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

Code in the TypeScript/NestJS service MUST use ES modules (`import`/
`export`); CommonJS MUST NOT be introduced. Tests covering new logic SHOULD be reviewed by the
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

**Version**: 3.0.0 | **Ratified**: 2026-07-27 | **Last Amended**: 2026-08-08
