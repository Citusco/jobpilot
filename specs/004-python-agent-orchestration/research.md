# Phase 0 Research: Python Agent Orchestration Service

## 1. Package manager and project tooling

**Decision**: `uv` for dependency management and virtual environments (`pyproject.toml`
as the single source of truth), `ruff` for linting and formatting, `mypy` for type
checking, `pytest` for testing.

**Rationale**: This is the first Python code in the project, so there's no existing
convention to match — same situation SCRUM-38 was in for NestJS tooling. Following this
project's established precedent of choosing tools with real learning/resume value when
there's no strong technical reason to prefer the alternative (`specs/001.../research.md`
§2: Drizzle over bare `pg`; `specs/001.../research.md` §3: Jest over Vitest), `uv` +
`ruff` (both by Astral) are the modern, fast, increasingly-standard choice in the current
Python ecosystem and a common combination to be asked about in interviews — matching
`npm`/`eslint`'s role on the TypeScript side. `mypy` mirrors `tsc --noEmit`'s role
(`npm run typecheck`) for parity with the existing `Bash commands` section in CLAUDE.md.

**Alternatives considered**:
- `pip` + `venv` + `requirements.txt`: the simplest, zero-extra-tooling path — rejected
  for the same reason bare `pg` was rejected for the TS side: it works, but skips the
  chance to practice modern dependency-management tooling in a project explicitly
  positioned to build that kind of experience.
- `poetry`: a reasonable, widely-used alternative — not chosen because `uv` is faster and
  increasingly the more current default being adopted across the ecosystem as of 2026,
  making it the more forward-looking choice for the same "resume relevance" reasoning.

## 2. Exact dependency versions

**Decision**: Pin exact versions (no `^`/`>=` ranges) for the four packages with a
documented history of breaking version-compatibility issues between each other
(`langgraph`, `langchain-core`, `langchain-openai`, `langgraph-prebuilt`), verified as
mutually compatible via PyPI metadata on 2026-08-03:

| Package | Version | Constraint satisfied |
|---|---|---|
| `langgraph` | `1.2.10` | requires `langchain-core>=1.4.7,<2` |
| `langchain-openai` | `1.4.1` | requires `langchain-core>=1.5.1,<2` |
| `langchain-core` | `1.5.3` | satisfies both of the above |
| `langsmith` | `0.10.15` | tracing SDK, `langchain-core` already depends on it transitively; pinned explicitly since this service uses tracing directly, not just incidentally |
| `fastapi` | `0.141.1` | requires `pydantic>=2.9.0` |

`langgraph-prebuilt` is not a direct dependency — this feature's 2-node graph needs
nothing from it (no prebuilt agents, no `ToolNode`); it's noted here only because it was
the source of the documented breaking-change precedent motivating exact pinning in the
first place, not because this feature imports it.

**Rationale**: A real, documented breaking change previously shipped between
`langgraph`-family packages because a compatible-version range wasn't enforced tightly
enough (community-reported issue, `langgraph-prebuilt` 1.0.2). Loose ranges (`^1.0`,
`>=1.0`) would let a routine `uv sync`/`pip install -U` silently pull in an incompatible
combination later. Exact pins, re-verified deliberately when there's a reason to
upgrade, avoid that class of failure. **These specific version numbers should be
re-verified against PyPI if implementation happens significantly later than
2026-08-03** — they are current-as-of-research, not a permanent pin.

**Alternatives considered**:
- Loose semver ranges (the npm-side convention already used for this project's
  TypeScript dependencies): rejected specifically for these four packages given the
  documented precedent; loose ranges remain fine for lower-risk dependencies like
  `fastapi` itself.

## 3. Structured output mechanism and validation

**Decision**: `ChatOpenAI(model=...).with_structured_output(Schema, method="json_schema",
include_raw=True)`, called via LCEL (`prompt | model_with_structured_output`) inside each
LangGraph node. `method="json_schema"` is explicit — the library's default structured-
output method has changed across releases, and `json_schema` is the closest Python/
LangChain analog to the TS side's deliberate choice of OpenAI's strict Structured
Outputs over function-calling-style output (`specs/001.../research.md` §1).
`include_raw=True` so a parsing failure is distinguishable from a call failure, and the
raw completion isn't lost inside an opaque exception (useful for the LangSmith trace
too).

Two independent validation layers (not redundant — see the architecture plan approved
earlier in this session, `~/.claude/plans/tidy-hatching-pinwheel.md`):
1. Inside each node, an explicit typed construction of the state-update object after
   `with_structured_output` returns — guards against LangGraph's documented gap (state
   is validated on node *input*, not on what a node *returns* before merging).
2. FastAPI's `response_model` on the `/extract` endpoint, mirroring
   `contracts/agent-orchestration.yaml`'s response schemas — a second, independent
   validation pass at the HTTP boundary.

**Rationale**: Already validated by a Plan-mode design pass earlier in this session
(see the plan file referenced above); restated here as the research.md record for this
feature's own Constitution Check, since Principle I requires this decision to be
traceable from the plan.

## 4. Timeout and retry policy for the OpenAI call

**Decision**: `ChatOpenAI(..., timeout=20, max_retries=2)` — LangChain's built-in
per-call timeout and retry support, not a hand-rolled wrapper. 20 seconds leaves margin
under this feature's own SC-001 budget (25s) and under the NestJS caller's existing
30-second timeout (`specs/003.../research.md` §2) — two LLM calls could in theory both
approach this budget in the worst case (extraction then generation), so the per-call
timeout is set well below the total budget, not equal to it.

**Rationale**: Consistent, two-layer timeout defense already established for the
NestJS→Python hop (`AgentOrchestrationClient`'s 30s `AbortController`); this is the next
layer in (Python→OpenAI). Using `ChatOpenAI`'s native `timeout`/`max_retries` parameters
avoids hand-rolling retry logic that LangChain already provides and tests.

**Alternatives considered**:
- No retry (fail on first error): rejected — a single transient network blip would
  needlessly surface as a full pipeline failure (NestJS's 502), when a bounded retry
  would resolve it silently; SC-001's 25s budget leaves enough room for one retry attempt
  within a typical single-digit-second LLM call.
- `.with_retry()` as a separate LCEL wrapper instead of the constructor's `max_retries`:
  functionally similar; the constructor parameter is simpler for this case since there's
  no need for custom retry predicates.

## 5. LangSmith tracing wiring

**Decision**: Standard LangChain/LangSmith env vars — `LANGCHAIN_TRACING_V2=true`,
`LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT` (e.g. `jobpilot-agent-orchestration`). No code
changes required to enable tracing; LCEL/LangGraph runs are automatically traced once
these env vars are set. If `LANGCHAIN_API_KEY` is unset or invalid, LangChain's own
tracing client fails open by default (logs a warning, does not raise or block the
request) — this already matches spec.md's Assumption that tracing must not become a
correctness dependency, with no additional code needed to enforce it.

**Rationale**: This is exactly the built-in behavior the user opted into (constitution
v2.1.0 amendment discussion) — zero-code observability is itself part of the LangChain
"characteristics" being deliberately experienced here.

## 6. Project layout

**Decision**: New top-level directory `agent-service/` (sibling to `src/`, `prisma/`,
per the repo-structure decision made earlier in this session), `src`-layout Python
package:

```text
agent-service/
├── pyproject.toml
├── src/
│   └── agent_service/
│       ├── main.py              # FastAPI app, POST /extract
│       ├── graph.py             # LangGraph StateGraph: nodes, conditional edge, compile
│       ├── nodes.py             # extract_jd_structure, generate_candidate_directions, reject_input
│       ├── schemas.py           # Pydantic models: request, response (sufficient/insufficient), graph state
│       └── llm.py               # ChatOpenAI construction (model, timeout, retries)
└── tests/
    ├── unit/                    # node-level tests, LLM call mocked (Principle II)
    └── contract/                # POST /extract HTTP-level tests via FastAPI's TestClient
```

**Rationale**: Mirrors the module-per-concern pattern already established on the NestJS
side (`src/agent-orchestration/`, `src/jd-submissions/`) without copying TypeScript
conventions that don't fit Python (e.g. no NestJS-style modules/DI container — FastAPI
doesn't need one for a single-router service this size). `src`-layout (not a flat
top-level package) is current Python packaging best practice, avoiding accidental
imports of uninstalled code during testing.
