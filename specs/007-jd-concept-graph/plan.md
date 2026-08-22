# Implementation Plan: JD Concept Graph

**Branch**: `007-jd-concept-graph` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-jd-concept-graph/spec.md`

## Summary

Connect a job description to the corpus for the first time, and delete the pipeline this
replaces. Four components change:

```
agent-service        /extract returns technical items; the graph loses its branch
NestJS               new resolve + graph services; jd-submissions reshaped around items
prisma               JdSubmission reshaped, ExtractedItem added, old model dropped
corpus tooling       a calibration run that derives the resolve threshold
```

The pipeline is short: JD text → items (one model call) → resolve each item (exact lookup, then
similarity) → store → serve the graph. No agent loop, no retry, no chunk retrieval.

Every design question is settled in `docs/DECISIONS.md` — the fifteen `2026-08-10` entries plus
the `2026-08-11` and `2026-08-21` corrections. Five `docs/DESIGN.md` sections carry
`[SUPERSEDED 2026-08-10]` and must not be followed. The measurements this plan relies on were
taken before the spec was written and are recorded in its Context table.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 22, ESM only, for the API and persistence side;
Python 3.12 for the agent service

**Primary Dependencies**: NestJS, Prisma, Zod; FastAPI, LangGraph, `langchain-openai`, boto3.
**Nothing is added.** Four empty scaffolding directories are removed (see Structure below)

**Storage**: PostgreSQL with pgvector. `Concept.embedding` is populated (70 vectors);
`DocChunk.embedding` remains empty and untouched by this feature

**Testing**: Jest under `tests/` (`contract/`, `integration/`, `unit/`); pytest for
`agent-service/`. No test calls a provider

**Target Platform**: local development — Postgres plus two services

**Project Type**: two services with an HTTP boundary, plus offline corpus tooling

**Performance Goals**: not a constraint. One model call for extraction, at most one embedding
batch for unresolved phrases, and a 70×70 similarity computation that is microseconds

**Constraints**: the graph must be identical across repeated requests for the same submission;
tier-1 resolution must not consult any similarity measure; the threshold must trace to a recorded
calibration run

**Scale/Scope**: 70 concepts, ~107 authored edges, ~240 inferred edges at the density target;
roughly 23 extracted items per posting, from the four measured

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1. No violations.*

| Principle | Applies | Assessment |
|---|---|---|
| **I. Schema-Validated LLM I/O** | Yes | Extraction returns structured output across the language boundary: a Pydantic model on the Python side, a Zod schema on the TypeScript side, validated before anything downstream. The existing `extract-response.schema.ts` is replaced rather than extended — its shape belongs to the removed pipeline |
| **II. Independently Testable LangGraph Nodes** | Yes | The graph loses its conditional branch and its reject node, leaving a single extraction node. That node is unit-tested in isolation with the provider mocked, as are the two it replaces today |
| **III. Plan-Before-Build** | Yes | Three triggers fire: database schema, LangGraph topology, and the contract between the two services. This document exists for that reason |
| **IV. Locked Technology Stack** | Yes | Nothing added. Four empty directories left from the original scaffolding are removed, one of which (`src/graph/nodes/`) actively contradicts the service split by implying LangGraph runs in TypeScript |
| **V. Definition of Done** | Yes | Typecheck, lint, Jest and pytest green; new logic has tests; the independent review applies to the resolution and calibration assertions, which are the ones worth not self-grading |

**Boundary check.** DESIGN.md §4.1 gives inference to Python and persistence plus retrieval to
TypeScript, and states that Python never touches the database. Honoured: the agent service
extracts items from text and embeds phrases, returning both; it is never told what a concept is.
Resolution, storage, similarity computation and graph assembly are all TypeScript-side. The
`/embed` endpoint added in SCRUM-44 is reused unchanged.

**Hard constraints touched.** Constraint 6 (vector matching needs a calibrated threshold) is the
centre of US3 and is what FR-016 through FR-019b enforce. Constraint 2 (`concept_id` never
renamed) is unaffected — no concept identity changes here. Constraints 1, 3, 4 and 5 concern
question generation and source text, neither of which this feature touches.

## Project Structure

### Documentation (this feature)

```text
specs/007-jd-concept-graph/
├── spec.md              # /speckit-specify output
├── plan.md              # This file
├── data-model.md        # Phase 1 -- schema delta and invariants
├── contracts/
│   ├── http-api.md      # Phase 1 -- the two public endpoints
│   └── extract.md       # Phase 1 -- the reshaped agent-service contract
├── checklists/
│   └── requirements.md  # spec quality checklist (16/16)
└── tasks.md             # /speckit-tasks output -- NOT created here
```

`research.md` and `quickstart.md` are deliberately not generated — see the Completion Report.

### Source Code (repository root)

```text
prisma/
├── schema.prisma                        # JdSubmission reshaped; ExtractedItem added;
│                                        #   CandidateTrainingDirection dropped
└── migrations/
    └── <ts>_jd_concept_graph/

agent-service/src/agent_service/
├── graph.py                             # single extraction node; branch and reject removed
├── nodes.py                             # make_extract_items_node replaces the two current nodes
├── schemas.py                           # ExtractedItem in; the directions models out
└── main.py                              # /extract reshaped; /embed unchanged

src/
├── jd-submissions/                      # reshaped around items, not directions
│   ├── jd-submissions.controller.ts     #   POST /jd-submissions, GET .../:id/graph
│   ├── jd-submissions.service.ts
│   └── schemas/
├── resolve/                             # new -- the two-tier resolver
│   ├── resolve.service.ts
│   └── resolve.module.ts
├── concept-graph/                       # new -- graph assembly
│   ├── concept-graph.service.ts
│   └── concept-graph.module.ts
├── corpus/normalize-term.ts             # existing; shared by ingest and tier 1
└── agent-orchestration/
    ├── agent-orchestration.client.ts    # extract() reshaped; embed() unchanged
    └── schemas/extract-response.schema.ts   # replaced

corpus/tools/
└── calibrate_threshold.py               # new -- derives the threshold, writes the record

tests/
├── contract/    jd-submissions, concept-graph, extract (reshaped)
├── integration/ submit-to-graph end to end
└── unit/        resolve tiers, graph assembly, edge density, schemas

REMOVED
  src/graph/  src/llm/  src/schemas/  src/types/     four .gitkeep-only directories
```

**Structure Decision**: two new NestJS modules rather than folding resolve and graph assembly
into `jd-submissions`. They are separately testable and have different lifetimes — resolution is
per item and will later serve question generation as well, while graph assembly is per submission
and exists to serve a client. Everything else follows the layout SCRUM-41/42/44 established.

The four removed directories contain only `.gitkeep`. They date from the original skeleton and
describe a structure that never happened; `src/graph/nodes/` is the harmful one, since it tells a
reader LangGraph lives in TypeScript when the whole service split says otherwise.

## Implementation Sequence

Ordering follows real dependencies:

1. **Migration first.** Everything writes through the new shape, and dropping the old model must
   precede reshaping the code that referenced it.
2. **Agent-service extraction next**, because its output shape defines what the TypeScript side
   validates and stores. Reshaping the graph also removes the branch that the old sufficiency
   gate depended on, which FR-004 and FR-022 forbid reinstating.
3. **Resolve, tier 1 only.** An exact lookup needs no provider and no threshold, so it is
   verifiable on its own — and it is the tier that must never be wrong.
4. **Calibration**, before tier 2 exists. Deriving the threshold first means tier 2 is built
   against a measured number rather than a placeholder that quietly survives.
5. **Resolve, tier 2**, using that threshold.
6. **Graph assembly**, which needs resolved items to have relevance to compute.
7. **Removal of the old pipeline**, last, so the new path is demonstrably working before the old
   one is deleted — with the exception of the Prisma model, which the migration in step 1 must
   drop.

## Risks

| Risk | Handling |
|---|---|
| Tier 1 resolves confidently to the wrong concept — `rate limiting` names one concept exactly while colloquially usually meaning another | Cannot be prevented at tier 1 by design; the exact match is the point. Mitigated by the graph: the neighbouring concept is one edge away and both surface. The integration test asserts that this specific pair does |
| The threshold is derived from concept-document phrasing and read as a verdict about real-world wording | FR-019b requires the calibration record to name its baseline. The plan treats it as a floor and the deferred second stage is written into the spec's Dependencies |
| Density tuning drifts as the corpus grows, because the edge cut is a fixed similarity value | FR-013 requires targeting mean degree, not a similarity number. Measured: 0.40 gives 605 inferred edges and 0.50 gives 84, so a fixed value would not survive corpus change |
| Removing the old pipeline breaks scaffolding the new one reuses | Removal is sequenced last, after the new path passes. FR-021 lists what must survive, and the existing health and prisma tests cover it |
| Storage becomes an accidental read dependency | FR-026 forbids it. The graph endpoint reads a submission's stored items, which is the one intended read; nothing else may require prior state |

## Constitution Re-Check (post-design)

Re-evaluated after `data-model.md` and both contracts. Still no violations, and the design made
two gates concrete rather than straining them.

- **Principle I** gained a specific obligation the contracts now carry: the extract response
  schema must assert that every evidence span is a substring of the submitted text. A model that
  paraphrases rather than quotes should fail at the boundary, not become a stored `evidence`
  value that cannot be found in the posting it claims to come from.
- **Principle II** is satisfied more simply than before: the graph goes from three nodes and a
  conditional edge to one node, and the node is unit-testable with the provider mocked.
- **The boundary held under design pressure.** The reshaped `/extract` returns unnormalised
  surface forms, which looked like an omission until the alternative was written out: normalising
  on the Python side would create a second `normalizeTerm`, and two implementations that drift
  produce lookups returning nothing with no error. The agent service still never learns what a
  concept is.

One design decision is worth flagging as deliberately unusual: `ExtractedItem.score` is null for
exact matches rather than `1.0`. Writing 1.0 would record a measurement that never happened, and
the distinction matters when explaining a wrong resolution after the fact.

## Complexity Tracking

No constitution violations. This section is intentionally empty.
