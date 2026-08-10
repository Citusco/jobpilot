# Implementation Plan: Corpus Structure Rebuild

**Branch**: `006-corpus-structure-rebuild` | **Date**: 2026-08-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-corpus-structure-rebuild/spec.md`

## Summary

Rebuild the offline corpus layer so it keeps every section of every admitted document, replaces
`kind` classification with structural metadata, and adds the term lookup and concept vectors the
concept point cloud will read. Three components change and one gains an endpoint:

```
corpus/tools/chunk_azure.py   rewritten     structure-first chunking, offsets, headingPath
prisma/schema.prisma          migrated      +ConceptTerm, DocChunk reshaped, 2 enums dropped
scripts/ingest-corpus.ts      extended      term expansion, candidate concepts, vectors
agent-service                 +1 endpoint   POST /embed -- the only place a provider is called
```

The pipeline stays what it already is — Python produces `corpus/_meta/chunks/azure.jsonl`,
TypeScript loads it into Postgres — with one addition: while loading, ingest asks the agent
service for concept vectors. It does not gain a provider client of its own.

Every design question is already settled in `docs/DECISIONS.md` under the fifteen `2026-08-10`
entries, and the numbers this plan relies on were measured against the real corpus before the
spec was written. Five sections of `docs/DESIGN.md` are marked `[SUPERSEDED 2026-08-10]` and must
not be followed.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 22 (ESM only, no CommonJS) for the API/persistence
service and the ingest script; Python 3.12 for the agent service; Python 3.x standard library
only for the corpus tools

**Primary Dependencies**: NestJS, Prisma (`prisma-client` generator), Zod, `@prisma/client`;
FastAPI, LangGraph, `langchain-openai`, boto3 on the Python side. **No dependency is added by
this feature. Two are removed** — `openai` and `@langchain/langgraph` are declared for the
TypeScript service and imported nowhere (FR-027)

**Storage**: PostgreSQL with the `vector` extension, via Prisma migrations. `Concept.embedding`
already exists as `vector(1536)` and is unpopulated; `DocChunk.embedding` is added by this
feature and stays unpopulated

**Testing**: Jest (ESM, `ts-jest/presets/default-esm`, `setupFiles: ['dotenv/config']`) rooted at
`tests/` with `contract/`, `integration/`, `unit/`; pytest for `corpus/tools/tests/` and
`agent-service/tests/`. Unit tests never call a provider

**Target Platform**: Linux/Windows dev machine plus a local Postgres. The corpus build is an
operator-run batch, not a served path

**Project Type**: two services plus an offline corpus toolchain

**Performance Goals**: not a constraint. The whole build is 49 documents and about 70 vectors —
the provider round-trips dominate and take seconds

**Constraints**: the build must be deterministic and idempotent. Identifiers and spans must be
byte-identical across runs, because they are the anchors verbatim citations and, later, answer
records point at

**Scale/Scope**: 49 admitted concepts + ~20 candidate concepts with no material; 58 source files;
~490 sections growing to ~571 chunks after splitting; ~124 mechanically derived terms; ~70
concept vectors

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design. No violations.*

| Principle | Applies | Assessment |
|---|---|---|
| **I. Schema-Validated LLM I/O** | Yes | The new `/embed` endpoint crosses the language boundary. Pydantic request/response models on the Python side, a Zod schema on the TypeScript side. The response schema MUST assert the vector length, not merely that it is an array of numbers — a model swap that returns 3072 values would otherwise fail later, at the column, with a worse error |
| **II. Independently Testable LangGraph Nodes** | Partially | `/embed` is a plain route, not a graph node, so the letter of this principle does not reach it. Its spirit does: the provider call is mocked in unit tests and no test calls a provider |
| **III. Plan-Before-Build** | Yes | Two triggers fire — database schema, and RAG/retrieval architecture (chunking strategy). A third fires under FR-025: a new operation on the contract between the two services. This feature is on the full flow, which is why this document exists |
| **IV. Locked Technology Stack** | Yes | Nothing added. `OpenAIEmbeddings` comes from `langchain-openai`, already declared. Two unused TypeScript dependencies are removed, which moves toward the locked stack rather than away |
| **V. Definition of Done** | Yes | Typecheck, lint, Jest and pytest all green; new logic has tests; the independent test review applies to the coverage and uniqueness assertions, which are the ones most worth not self-grading |

**Boundary check.** DESIGN.md §4.1 assigns inference to Python and persistence plus retrieval to
TypeScript, and states that Python does not connect to the database. This plan honours all three:
the agent service computes a vector and returns it, never storing or reading one; ingest writes
it; similarity search, when it arrives, is a pgvector query on the TypeScript side (FR-026).

**Hard constraints touched.** Constraint 1 (no LLM may rewrite source text) — the provider sees
only concept names, terms and definition text assembled for embedding, and never produces text
that is stored. Constraint 2 (`concept_id` never renamed) — the ~20 candidate concepts are new
ids, no existing id changes. Constraint 6 (vector matching needs a calibrated threshold) — no
matching happens in this feature; FR-022 produces the baseline distributions a threshold will
later be calibrated from.

## Project Structure

### Documentation (this feature)

```text
specs/006-corpus-structure-rebuild/
├── spec.md              # /speckit-specify output
├── plan.md              # This file
├── data-model.md        # Phase 1 -- schema delta and invariants
├── contracts/
│   └── embed.md         # Phase 1 -- the POST /embed contract
├── quickstart.md        # Phase 1 -- the five-step, three-component build sequence
├── checklists/
│   └── requirements.md  # spec quality checklist (16/16)
└── tasks.md             # /speckit-tasks output -- NOT created here
```

`research.md` is deliberately not generated — see the Completion Report.

### Source Code (repository root)

```text
prisma/
├── schema.prisma                          # ConceptTerm added; DocChunk reshaped; 2 enums dropped
└── migrations/
    └── <ts>_corpus_structure_rebuild/     # one migration, this feature

corpus/
├── tools/
│   ├── chunk_azure.py                     # rewritten: preamble, all sections, offsets,
│   │                                      #   headingPath, size-bounded splitting, new chunk_id
│   └── tests/
│       └── test_chunk_azure.py            # extended: coverage, determinism, split invariants
└── _meta/
    ├── candidates/azure.jsonl             # input, now tracked
    └── chunks/azure.jsonl                 # output, gitignored

src/
├── corpus/
│   └── normalize-term.ts                  # the single normalization implementation
└── agent-orchestration/
    ├── agent-orchestration.client.ts      # + embed()
    └── schemas/
        └── embed-response.schema.ts       # Zod, asserts vector length

scripts/
└── ingest-corpus.ts                       # + term expansion, candidate concepts, vectors

agent-service/src/agent_service/
├── main.py                                # + POST /embed
├── embeddings.py                          # the provider call, beside llm.py
└── schemas.py                             # + EmbedRequest / EmbedResponse

tests/
├── contract/
│   ├── concept-doc-chunk-schema.test.ts   # updated for the new shape
│   └── embed.contract.test.ts             # new
├── integration/
│   └── ingest-corpus.test.ts              # updated; + idempotency, + term uniqueness
└── unit/
    ├── corpus/normalize-term.test.ts      # new
    └── agent-orchestration/
        └── embed-response.schema.test.ts  # new

agent-service/tests/
├── contract/test_embed.py                 # new
└── unit/test_embeddings.py                # new, provider mocked
```

**Structure Decision**: no new top-level structure. The feature follows the layout SCRUM-41 and
SCRUM-42 established — corpus tooling under `corpus/tools/`, the loader as a standalone script
under `scripts/`, service code under `src/` and `agent-service/src/`, and all TypeScript tests
under the single `tests/` root that `jest.config.ts` points at. One new directory, `src/corpus/`,
holds `normalizeTerm` because it is shared between the ingest script and the future `resolve`
and belongs to neither alone.

## Implementation Sequence

Ordering is dictated by real dependencies, not preference:

1. **Migration first.** Everything else writes through the new shape. Dropping `kind` and
   `kindConfidence` requires the existing rows to go, so the migration truncates `doc_chunk` —
   acceptable because it is entirely rebuildable from the source layer, and because every
   `chunk_id` changes anyway.
2. **`normalizeTerm` next**, alone and tested, because both ingest and the uniqueness test depend
   on it and a second implementation appearing later is the specific failure this guards against.
3. **Chunker rewrite**, verified by the coverage assertion before anything is loaded. A chunker
   that drops text would otherwise be discovered only after the database is populated.
4. **Ingest extension** — terms, candidate concepts, then vectors, in that order. Terms and
   candidates need no provider, so they are verifiable while the endpoint is still being built.
5. **`/embed` and the client**, last, since they are the only part with an external dependency
   and the only part that can fail for reasons unrelated to this feature.

## Risks

| Risk | Handling |
|---|---|
| The chunker rewrite silently loses text, exactly as the two defects it fixes did | The coverage assertion is written before the rewrite and run against the real corpus, not fixtures. It fails the build rather than reporting a warning |
| `normalizeTerm` gets a second implementation later, so lookups miss silently | One exported function, imported by ingest and by the test; the test asserts uniqueness using the same function ingest uses |
| A model change alters vector length and corrupts the column | The Zod response schema asserts length, so the mismatch surfaces at the boundary rather than at the database |
| The build now needs the agent service running, and someone runs it without | Ingest fails with a message naming the missing service, and the vector step is the last step, so terms and chunks are already committed when it fails |
| Splitting cuts inside a fenced code block | Fences are masked before boundaries are chosen, as the current chunker already does; a section that cannot be split without cutting a fence stays whole and exceeds the cap, which the spec permits |

## Constitution Re-Check (post-design)

Re-evaluated after `data-model.md` and `contracts/embed.md` were written. Still no violations,
and the design tightened two of the gates rather than straining them:

- **Principle I** became concrete. `contracts/embed.md` requires the Zod schema to assert vector
  length rather than merely `number[]`, so a model swap returning 3,072 values fails at the
  boundary naming the model instead of at a `vector(1536)` column.
- **Principle IV** confirmed against the actual dependency lists. `OpenAIEmbeddings` ships in
  `langchain-openai`, already pinned in `agent-service/pyproject.toml`. Nothing is added, and
  FR-027 removes two TypeScript dependencies that are declared but imported nowhere.
- **Principle III**'s third trigger — the service contract — is discharged by
  `contracts/embed.md` rather than left implicit in plan prose.

The boundary check also survived contact with the design: the endpoint takes text and returns
vectors, with no concept ids in either direction, so the agent service cannot acquire a reason to
read the database.

## Complexity Tracking

No constitution violations. This section is intentionally empty.
