# Implementation Plan: Python Agent Orchestration Service (FastAPI + LangGraph + LangChain)

**Branch**: `scrum-41-python-agent-orchestration` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-python-agent-orchestration/spec.md`

## Summary

Implement `POST /extract` in a new Python service (`agent-service/`, sibling to `src/`
and `prisma/` in this same repo), fulfilling the HTTP contract SCRUM-39's NestJS client
already implements against (`specs/003-jd-extraction-nestjs-integration/contracts/
agent-orchestration.yaml`). Internally: a two-node LangGraph `StateGraph`
(`extract_jd_structure` → conditional edge on `sufficient` → `reject_input` or
`generate_candidate_directions`), each node calling OpenAI via LangChain
(`ChatPromptTemplate` + LCEL + `ChatOpenAI.with_structured_output`), validated against
Pydantic schemas at two independent layers (in-node, and FastAPI's `response_model`).
LangSmith tracing enabled. This is the first Python code in the project and the piece
that makes the end-to-end pipeline (NestJS → Python → OpenAI → back → Postgres) complete
for the first time. Per spec.md's explicit scope: extraction/generation *quality* is not
this feature's acceptance bar — pipeline correctness is.

## Technical Context

**Language/Version**: Python >=3.10 (required by `langgraph-prebuilt`/`langsmith`
transitively); targeting 3.12 as the concrete interpreter version — modern, stable, safely
within range.

**Primary Dependencies**: `fastapi==0.141.1`, `langgraph==1.2.10`,
`langchain-core==1.5.3`, `langchain-openai==1.4.1`, `langsmith==0.10.15`, `pydantic`
(resolved via FastAPI/LangChain's own constraints, `>=2.9.0`). Dev-only: `uv` (package
manager), `ruff` (lint + format), `mypy` (type check), `pytest` (test runner). Exact
versions and rationale for pinning in research.md §2.

**Storage**: None — this service is stateless by design (research.md §6, spec.md Key
Entities). All persistence stays owned by the NestJS/Prisma service (specs/002, 003).

**Testing**: `pytest`, LLM calls mocked in all automated tests (constitution Principle
II) — `tests/unit/` for node-level logic, `tests/contract/` for the full `POST /extract`
HTTP contract via FastAPI's `TestClient`.

**Target Platform**: Linux server (Python backend service), same deployment model as
the NestJS service — a separate deployable, not a library.

**Project Type**: Single-service web API (Python), sibling to the existing NestJS
service in this same repo (monorepo, per the repo-structure decision made earlier in
this session).

**Performance Goals**: SC-001 — a well-formed request with a successful underlying LLM
call responds within 25 seconds (leaving margin under the NestJS caller's existing
30-second timeout, `specs/003.../research.md` §2).

**Constraints**: Zero raw/unvalidated LLM output may reach the HTTP response
(constitution Principle I); response shape must exactly match the pre-existing contract
(FR-006) — this feature does not get to redefine it, only implement it.

**Scale/Scope**: One endpoint (`POST /extract`), one two-node LangGraph graph, zero
persistence, zero new public contracts (implements an existing one).

No `NEEDS CLARIFICATION` markers remain.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Schema-Validated LLM I/O**: Directly applicable — this is the first feature that
  actually calls an LLM. Two independent Pydantic validation layers designed
  (research.md §3): in-node re-validation after `with_structured_output`, plus FastAPI's
  `response_model` at the HTTP boundary. PASS.
- **II. Independently Testable LangGraph Nodes**: Directly applicable — `nodes.py`'s two
  LLM-calling functions are each unit-testable in isolation with `pytest`, LLM call
  mocked. PASS, with the test tasks in tasks.md enforcing this.
- **III. Plan-Before-Build for Structural Changes**: This feature IS the LangGraph
  topology this principle names, and also touches the service boundary (it's the first
  implementation of the Python side of a boundary SCRUM-39 only defined) — confirms Full
  SDD is the correct, required workflow already in use. PASS.
- **IV. Locked Technology Stack**: Uses exactly the stack constitution v2.1.0 locked
  (Python + FastAPI + LangGraph + LangChain), no undiscussed additions. `uv`/`ruff`/
  `mypy` are dev-only tooling choices (research.md §1), not runtime stack additions,
  same category as the TS side's `eslint`/`tsc` — not a Principle IV concern. PASS.
- **V. Definition of Done**: New logic (graph, nodes, schemas) requires tests per
  Definition of Done; `pytest`/`ruff`/`mypy` are this service's equivalent of
  `test`/`lint`/`typecheck`; tests reviewed by `test-reviewer` at implementation time,
  same practice as prior features. PASS.

No violations — Complexity Tracking table is not needed.

**Post-Phase-1 re-check**: research.md and quickstart.md don't introduce anything beyond
what Technical Context already covers. Still PASS on all five principles.

## Project Structure

### Documentation (this feature)

```text
specs/004-python-agent-orchestration/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── quickstart.md         # Phase 1 output
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

No data-model.md — this service is stateless, no new entities. No new contracts/ — this
feature implements the contract already authored at
`specs/003-jd-extraction-nestjs-integration/contracts/agent-orchestration.yaml`, it does
not define a new one.

### Source Code (repository root)

```text
agent-service/                    # NEW top-level directory, sibling to src/, prisma/
├── pyproject.toml
├── src/
│   └── agent_service/
│       ├── main.py               # FastAPI app, POST /extract (FR-001, FR-006, FR-007)
│       ├── graph.py               # StateGraph: nodes, conditional edge, compile once
│       ├── nodes.py               # extract_jd_structure, generate_candidate_directions,
│       │                          # reject_input (FR-002, FR-003, FR-004)
│       ├── schemas.py             # Pydantic: request, ExtractSufficient/Insufficient
│       │                          # response (FR-006), graph state (FR-005)
│       └── llm.py                 # ChatOpenAI construction: model, timeout, retries,
│                                   # LangSmith env vars documented (research.md §4, §5)
└── tests/
    ├── unit/                      # node-level tests, LLM mocked (Principle II)
    └── contract/                  # POST /extract via FastAPI TestClient

# UNCHANGED: src/, prisma/, tests/ (the existing NestJS service) — this feature adds a
# sibling service, does not modify the NestJS side at all
```

**Structure Decision**: New top-level `agent-service/` directory in the same repo
(monorepo — decided earlier in this session: repo-count is a source-control axis,
independent of the runtime microservices boundary constitution Principle IV already
locks in). `src`-layout Python package, module-per-concern mirroring the pattern already
established on the NestJS side (`src/agent-orchestration/`, `src/jd-submissions/`)
without importing TypeScript/NestJS-specific conventions (no DI container — FastAPI
doesn't need one for a single-router service this size).

## Complexity Tracking

*No entries — Constitution Check has no violations to justify.*
