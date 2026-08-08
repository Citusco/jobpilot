# Implementation Plan: Corpus Ingest Foundation — concept/doc_chunk Schema + Azure Chunking Pipeline

**Branch**: `scrum-42-corpus-ingest-foundation` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-corpus-ingest-foundation/spec.md`

## Summary

Add `Concept` and `DocChunk` to `prisma/schema.prisma` (new tables, additive migration —
no existing table touched) resolving DESIGN.md §13's open decision #5. Build a new,
azure-only Python tool under `corpus/tools/` (`chunk_azure.py`) that chunks the
already-fetched azure corpus per DESIGN.md §7.5's exact spec (H2+H3 split, code-fence
protection, regex kind classification, bold-label item split, contextual prefix,
related-link extraction, directive cleanup) and writes two JSONL files — one row per
`DocChunk` candidate, one row per `Concept` candidate (one per azure pattern, `candidate`
status, for human accept/reject) — plus an unmapped-headings report, all with zero
database access from Python. A new TypeScript script (`scripts/ingest-corpus.ts`) reads
those JSONL files and performs the actual idempotent (content-hash-keyed) writes into
Postgres through the Prisma client NestJS already generates from the same schema. No
online pipeline step (extract/resolve/combine/retrieve/generate/verify), no other corpus
source, no embedding computation, no touching the existing `JdSubmission`/
`CandidateTrainingDirection` tables.

## Technical Context

**Language/Version**: TypeScript (schema/migration + ingest, matching the existing
`prisma/schema.prisma` toolchain and Node.js runtime) + Python 3.12 (chunking only,
matching `corpus/tools/`'s existing scripts and venv, established in the corpus-build
feature)

**Primary Dependencies**:
- Schema/migration + ingest side: `prisma` and `@prisma/client` (both existing, already in
  `package.json`) — no new TypeScript dependency. `scripts/ingest-corpus.ts` runs via the
  same `ts-node`/ESM setup `package.json`'s `dev` script already uses
  (`scripts/register-ts-node.mjs`), not a new script-running mechanism.
- Chunking side (`corpus/tools/`, existing local venv at `corpus/.venv/`): `pyyaml`
  (existing, already used by `fetch_git.py`/`fetch_html.py`) and `pytest` (new — no test
  tooling exists yet under `corpus/tools/`, and Constitution V requires new logic to have
  tests). No database driver — per research.md §1's revised decision, chunking never
  touches Postgres; `psycopg2-binary`, considered in an earlier draft of this plan, is not
  needed.

**Storage**: PostgreSQL (the same instance/`DATABASE_URL` NestJS already uses via
Prisma), with `Concept`/`DocChunk` tables created and migrated by Prisma. Rows are written
exclusively by `scripts/ingest-corpus.ts` through the generated Prisma client — the same
client, schema, and generated types NestJS itself uses, not a second, independently
written client. `corpus/tools/chunk_azure.py` (Python) never connects to Postgres; it
writes `corpus/_meta/chunks/azure.jsonl` and `corpus/_meta/candidates/azure.jsonl`
(research.md §3), which `ingest-corpus.ts` reads.

**Testing**: `pytest` for `chunk_azure.py`'s chunking/classification logic
(chunk-boundary correctness, kind regex matching, unmapped-heading detection) — pure
functions from a markdown file to JSONL lines, needing no database at all, which resolves
what was an open question in an earlier draft of this plan (whether chunking tests would
need "a temp Postgres or a stub connection" — they don't, by construction, now that
chunking and database access are different scripts). Jest (existing, `@nestjs/testing`)
for `scripts/ingest-corpus.ts`'s idempotency/upsert/delete-and-replace logic, run against a
real (test) Postgres database through the real Prisma client — the natural way to test
Prisma-based write logic, rather than mocking the client. Prisma migration shape verified
the same lightweight way spec 002-nestjs-prisma-migration's contract test did (query
`information_schema` after `prisma migrate dev`).

**Target Platform**: Local/CI batch execution — this is offline tooling invoked by a
human operator (or a future CI job), not a deployed service; no server process, no HTTP
port

**Project Type**: Single-repo addition — a database schema addition (TypeScript/Prisma
side) plus a CLI batch-tool addition (Python side, `corpus/tools/`) — not a new service

**Performance Goals**: None beyond finishing in a reasonable interactive time against the
azure corpus's actual size (58 files) — this is a one-off/periodic batch job, not a
request-serving path, so no latency/throughput target applies

**Constraints**: Byte-for-byte verbatim source text in every `doc_chunk.content` (spec
SC-001); true idempotency on repeated runs (SC-002); every H2/H3 heading accounted for —
classified, rule-discarded, or reported unmapped, never silently absent (SC-003);
`concept_id`/`chunk_id` stability once written (spec FR-004, FR-005); zero LLM involvement
in chunk boundaries or `kind` classification (spec FR-019); azure-only scope

**Scale/Scope**: 58 azure source files fetched (`corpus/_meta/manifest/azure.jsonl`), of
which 49 are concept-eligible (43 `docs/patterns/*.md` + 6
`docs/guide/architecture-styles/*.md`, excluding index/repo-meta/multi-concept-comparison
files — spec.md SC-005) → one `concept` candidate per eligible file (49 candidates) and,
per DESIGN.md §5's chunk-scale expectation, on the order of a few hundred `doc_chunk` rows

No `NEEDS CLARIFICATION` markers remain in Technical Context.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Schema-Validated LLM I/O**: N/A for this feature's mandatory scope — no LLM call is
  required by any FR (chunking/classification is 100% regex-based per spec FR-019).
  research.md §1 notes an *optional* LLM use (drafting candidate aliases/descriptions) the
  spec leaves as an implementation choice; if `plan`/`tasks` takes that option, its output
  MUST be validated through a Pydantic or Zod schema before being written anywhere, same as
  every other LLM call in this project. PASS (conditionally, satisfied either way).
- **II. Independently Testable LangGraph Nodes**: N/A — this feature adds no LangGraph
  node; it doesn't touch the agent orchestration service at all. PASS.
- **III. Plan-Before-Build for Structural Changes**: This feature changes the database
  schema (new tables) and defines a chunking/retrieval-adjacent strategy — both explicit
  Full-SDD triggers — confirming Full SDD is the correct workflow already in use. PASS.
- **IV. Locked Technology Stack**: The schema addition uses Prisma exactly as approved (no
  new ORM/migration tool), and — per research.md §1's revised decision — so does every
  database write this feature makes: `scripts/ingest-corpus.ts` writes through the same
  Prisma client NestJS generates from `prisma/schema.prisma`. No Python process connects
  to Postgres anywhere in this feature, so Constitution IV's "Python does not connect to
  the database" language (echoed in DESIGN.md §4.1) simply isn't implicated — there is no
  judgment call left to record here, unlike an earlier draft of this plan, which reasoned
  (soundly, but as a defense that would need to be reasoned through again by a future
  reader) that a direct Python-to-Postgres connection from offline batch tooling wouldn't
  violate the spirit of that constraint. `pytest` (Python, chunking tests) and
  `@prisma/client`/`ts-node` (TypeScript, ingest — both already in `package.json`) are the
  only dependency additions, none outside either locked service's already-approved stack.
  PASS, cleanly rather than by argument.
- **V. Definition of Done: Typed, Tested, Reviewed**: `corpus/tools/` gains its first test
  suite as part of this feature (chunking, classification, idempotency, unmapped-report
  logic) — Constitution V's "untested new logic does not count as done" is met by
  including this in scope rather than deferring it. TypeScript side stays ES modules
  (schema-only change, no new source file). Tests should go through the `test-reviewer`
  subagent at `/speckit-tasks`/`/speckit-implement` time per project practice. PASS.

No violations — Complexity Tracking table is not needed.

**Post-Phase-1 re-check**: data-model.md's four-state `status` enum on `Concept` (adding
`candidate` beyond DESIGN.md §5's three literal states) is a schema decision, not a new
service or LLM call — doesn't touch any gate above. quickstart.md's manual verification
flow doesn't introduce anything beyond what Technical Context already covers. Still PASS
on all five principles.

**Second re-check, post-review-corrections (2026-08-08)**: an external review of
`spec.md`/`data-model.md` after this plan was first written found four issues (three
blocking/irreversible) — see `checklists/requirements.md`'s Notes for the full list:
`concept_id` derivation (raw-filename suffixes), SC-005's candidate-count basis (58 → 49,
with an explicit exclude list), `chunk_id`'s scheme (positional index → label-derived
slug), and the contextual prefix moving out of `content` into a separate `context_prefix`
column. None of the four introduce a new dependency, a new service, a new LLM call, or a
new external interface — they correct field-derivation rules and a success-criterion's
count within the schema and scope this plan already committed to. No Constitution gate is
newly implicated: Principle IV's stack list is unaffected (still Prisma + `psycopg2-binary`
+ `pytest`, no additions); Principle I is unaffected (fix 4 *removes* a way source text
could be silently mis-verified, which if anything strengthens compliance with the "no
rewriting source text" spirit this project cares about, though Principle I itself is about
LLM I/O schemas, not this). Still PASS on all five principles — no plan.md structural
section needed a rewrite, only the Scale/Scope line above (58 → 49-eligible, now
corrected).

**Third re-check, post-second-review-corrections (2026-08-08)**: a second review pass,
measured directly against `corpus/raw/azure/` and independently re-verified before
editing, found and fixed five more items — one blocking (SC-001 and FR-012 had come to
contradict each other after the second-round content/context_prefix split: FR-012 still
described stripping link markup down to visible text, which would fail SC-001's
zero-exception substring guarantee for the 41 of 106, 38.7%, of tradeoff chunks that
contain a link), three classification-rule refinements measured against the real corpus
(`Advantages` added to the benefit regex; a parent-guard so a heading nested under
`Context and problem` is never misclassified as a tradeoff of its own pattern, motivated
by one real case in `saga-content.md`; the item-level bullet pattern extended from one
labeled form covering 5.6% of real bullets to four forms covering 22.2%), and one
documentation-only addition (research.md §6, recording corpus measurements that
contradict two of DESIGN.md's own claims — see that section). All five are scoped to
chunking/classification rules and a documentation section; none add a database column,
a dependency, a service, or an LLM call, so no Constitution gate is newly implicated —
still PASS on all five principles. `plan.md`'s own structural sections (Technical
Context, Project Structure) needed no changes; only this note and the `research.md`
addition were needed.

**Fourth re-check, database write-path change (2026-08-08)**: two corrections. First, a
measurement fix with no design impact: research.md §6's aspnet heading table had silently
mixed an H2-only count into an otherwise H2+H3 table for two headings ("Affected APIs,"
"Rule description") — corrected to 155/56 (H2+H3, consistent with the rest of that table),
up from an erroneous 125/36 — no FR/SC/gate affected, this is a documentation-accuracy fix
only. Second, a real mechanism change: the database write path moved from a Python script
opening a direct `psycopg2` connection to a TypeScript script (`scripts/ingest-corpus.ts`)
writing through the Prisma client, with a JSONL file (`corpus/_meta/chunks/azure.jsonl` +
`corpus/_meta/candidates/azure.jsonl`) as the seam between chunking and ingest — see
research.md §1 (revised), §3 (rewritten), §5 (updated for the new script boundary). This
*simplifies* the Constitution IV gate above (removes a judgment call, doesn't introduce
one) and drops a dependency (`psycopg2-binary`) rather than adding one. Technical Context,
Storage, Testing, and Project Structure below are updated to match. Still PASS on all five
principles, more straightforwardly than before on Principle IV specifically.

## Project Structure

### Documentation (this feature)

```text
specs/005-corpus-ingest-foundation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks — not created by this command)
```

No `contracts/` — see research.md §2 for why (no new external interface; the CLI tools
this feature adds are self-documenting via `--help`, matching every existing
`corpus/tools/` script).

### Source Code (repository root)

```text
prisma/
├── schema.prisma              # + model Concept, model DocChunk (data-model.md)
└── migrations/
    └── <timestamp>_add_concept_and_doc_chunk/
        └── migration.sql      # generated by `prisma migrate dev`

scripts/
├── register-ts-node.mjs        # UNCHANGED (existing, used by `npm run dev`)
└── ingest-corpus.ts            # NEW — reads corpus/_meta/chunks/azure.jsonl +
                                 # corpus/_meta/candidates/azure.jsonl, writes Concept/
                                 # DocChunk rows via @prisma/client (idempotent,
                                 # content-hash-keyed — research.md §1/§5). Does NOT write
                                 # the unmapped-headings report — that's chunk_azure.py's
                                 # output (pure text processing, no DB dependency; see the
                                 # corpus/reports/ entry below and Summary above,
                                 # which already attributed it there — this tree had drifted)

corpus/
├── sources.yaml                # UNCHANGED
├── tools/
│   ├── fetch_git.py            # UNCHANGED (existing, corpus-build feature)
│   ├── fetch_html.py           # UNCHANGED
│   ├── filter_md.py            # UNCHANGED
│   ├── structure_probe.py      # UNCHANGED
│   ├── build_manifest_git.py   # UNCHANGED
│   ├── build_summary.py        # UNCHANGED
│   ├── chunk_azure.py          # NEW — implements DESIGN.md §7.5 against corpus/raw/azure/,
│   │                            # writes the two JSONL files below (research.md §3) AND
│   │                            # the unmapped-headings report (below); no database access
│   ├── requirements.txt        # NEW — pins corpus/tools/'s Python deps (gap from the
│   │                            # prior feature: corpus/.venv existed but was never pinned) —
│   │                            # just pyyaml + pytest for this feature (research.md §4)
│   └── tests/
│       └── test_chunk_azure.py     # NEW — chunking/classification unit tests (fixtures,
│                                    # no real corpus or database needed)
└── _meta/
    ├── chunks/
    │   └── azure.jsonl         # NEW — chunk_azure.py output, DocChunk candidates
    │                            # (research.md §3), read by scripts/ingest-corpus.ts
    ├── candidates/
    │   └── azure.jsonl         # NEW — chunk_azure.py output, Concept candidates
    │                            # (research.md §3), read by scripts/ingest-corpus.ts
    └── reports/
        └── unmapped-headings-azure.md   # NEW — output of scripts/ingest-corpus.ts

tests/
├── contract/
│   └── concept-doc-chunk-schema.test.ts  # NEW — verifies the migrated table/column
│                                          # shape via information_schema, same pattern
│                                          # as spec 002's migration-shape contract test
└── integration/
    └── ingest-corpus.test.ts   # NEW — scripts/ingest-corpus.ts's idempotency/
                                 # upsert/delete-and-replace logic against a real
                                 # (test) Postgres database via the real Prisma client
```

**Structure Decision**: No new top-level project or service. The schema and ingest halves
of this feature extend the existing single NestJS/Prisma project exactly as spec
002-nestjs-prisma-migration already established (`prisma/schema.prisma` +
`prisma/migrations/`), with `scripts/ingest-corpus.ts` as a standalone script run the same
way `scripts/register-ts-node.mjs` already is — not a new NestJS module, controller, or
endpoint. The chunking half extends the existing `corpus/tools/` script collection
(Python, plain venv) established in the corpus-build feature — no new Python
package/service is created, and `agent-service/` (the actual Python agent orchestration
service, FastAPI + LangGraph + LangChain) is untouched and unrelated to this feature.

## Note for `/speckit-tasks`: what the chunking task description must state

`research.md` §6's corpus measurements (heading-coverage counts, the bullet-label
distribution, the two DESIGN.md contradictions) were produced by one-off measurement
scripts written during this feature's review passes to establish orders of magnitude and
decide direction. **Those scripts are not part of this repository and must not be
reconstructed or treated as an implementation starting point for `chunk_azure.py`.** They
are known to be imprecise at code-fence boundaries and similar edges — an independent
re-count of the same corpus during this feature's own review differed from an earlier pass
by 1-2 on two heading rows, and a separate pass found two other rows silently computed on
the wrong counting basis (H2-only vs. H2+H3) before being caught. The relationship is
one-way: the *numbers* in `research.md` §6 are the durable, referenceable output (they
justify FR-008a, FR-009's four bullet forms, FR-006's corrected rationale, and the
benefit-gap deferred-decision note); the *code* that produced them is not something to
carry forward.

When `/speckit-tasks` generates the task that implements `chunk_azure.py`, its description
MUST state this explicitly (inline in that task, not as a separate task): implement
FR-006 through FR-015 directly from the spec, with the task's own fixture-based tests
(`corpus/tools/tests/test_chunk_azure.py`) — not derived from, or validated against, any
prior measurement script. Treating an ad hoc measurement script as a code foundation would
bake its approximations into shipped behavior, and the resulting discrepancy would be
invisible precisely because the implementation and the (wrong) measurement would agree
with each other.

## Complexity Tracking

*No entries — Constitution Check has no violations to justify.*
