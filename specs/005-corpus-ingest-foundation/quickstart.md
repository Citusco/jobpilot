# Quickstart: Corpus Ingest Foundation

End-to-end manual validation of this feature, once implemented. Assumes `DATABASE_URL`
is already set (same Postgres instance NestJS/Prisma already uses) and
`corpus/raw/azure/` is populated — if not, regenerate it first:

```bash
corpus/.venv/Scripts/python corpus/tools/fetch_git.py --only azure
corpus/.venv/Scripts/python corpus/tools/filter_md.py
```

## 1. Apply the schema migration

```bash
npx prisma migrate dev --name add_concept_and_doc_chunk
```

Expect: a new `prisma/migrations/<timestamp>_add_concept_and_doc_chunk/migration.sql`
creating `concepts` and `doc_chunks`, with `JdSubmission`/`CandidateTrainingDirection`
untouched.

## 2. Install the new Python dependency

```bash
corpus/.venv/Scripts/pip install -r corpus/tools/requirements.txt
```

(Just `pyyaml` + `pytest` for this feature — chunking never touches Postgres, so no
database driver is installed here; see research.md §1/§4.)

## 3. Chunk the azure corpus

```bash
corpus/.venv/Scripts/python corpus/tools/chunk_azure.py
```

Expect console output naming each source file processed and a summary chunk count by
`kind`, and two new files: `corpus/_meta/chunks/azure.jsonl` (one line per `DocChunk`
candidate) and `corpus/_meta/candidates/azure.jsonl` (one line per `Concept` candidate,
49 lines). This step only reads `corpus/raw/azure/` and writes these two JSONL files — it
does not touch Postgres at all (research.md §1), so the output can be inspected and diffed
before anything reaches the database.

## 4. Ingest into Postgres

```bash
npx ts-node --esm scripts/ingest-corpus.ts
```

(Or however this repo's existing `ts-node`/ESM invocation is wired — see
`scripts/register-ts-node.mjs` and `package.json`'s `dev` script for the established
pattern.)

Expect: `Concept` candidate rows (one per azure pattern, `status = candidate`) and
`DocChunk` rows written via the Prisma client; a summary of rows inserted/skipped/replaced;
the unmapped-headings report written to
`corpus/reports/unmapped-headings-azure.md`.

## 5. Spot-check verbatim fidelity (SC-001)

```bash
npx prisma studio
```

Or, via `psql`:

```bash
psql "$DATABASE_URL" -c "SELECT chunk_id, content, source_url FROM doc_chunks WHERE kind = 'benefit' LIMIT 5;"
```

Pick a couple of the printed `chunk_id`/`source_url` pairs and manually confirm `content`
(which holds **only** verbatim source text — the contextual prefix lives in the separate
`context_prefix` column, FR-013) appears word-for-word in the linked source page, with zero
exceptions (including for chunks containing a markdown link — FR-012 requires the full
link markup retained byte-for-byte, not just its visible text).

## 6. Confirm `Benefits of CQRS` (the H3-nesting case DESIGN.md flagged) is captured

```bash
psql "$DATABASE_URL" -c "SELECT chunk_id, label FROM doc_chunks WHERE pattern_id = 'cqrs' AND kind = 'benefit';"
```

Expect at least one row whose `label` reflects the H3 heading nested under `## Solution` —
this is SC-004's direct check.

## 7. Review the unmapped-headings report

Open `corpus/reports/unmapped-headings-azure.md`. Expect a frequency-ranked list of
any heading that matched none of the `kind` regexes — review it, and confirm any heading
recognized-but-discarded (e.g. `Workload design`) does **not** appear here (spec FR-021),
and that no heading nested under `Context and problem` was assigned a tradeoff `kind`
(FR-008a).

## 8. Confirm idempotency (SC-002)

```bash
npx ts-node --esm scripts/ingest-corpus.ts
```

Re-run step 4 unchanged and diff row counts before/after via
`SELECT count(*) FROM doc_chunks;`. Expect zero rows added, removed, or modified on a
second run against unchanged source files — `scripts/ingest-corpus.ts` compares each
source file's `content_hash` against what's already recorded and skips it entirely when
unchanged (research.md §5).

## 9. Review and admit a concept candidate

```bash
psql "$DATABASE_URL" -c "SELECT concept_id, name, kind, aliases, related FROM concepts WHERE status = 'candidate' LIMIT 5;"
```

Then admit one by hand for this validation pass (the actual admission tool is
implementation detail for `/speckit-tasks`; any equivalent works for this check):

```sql
UPDATE concepts SET status = 'active' WHERE concept_id = 'cqrs';
```

Confirm the row's `status` changed and its `concept_id` is unchanged (FR-004).

## 10. Run the test suites

```bash
corpus/.venv/Scripts/pytest corpus/tools/tests/
npx jest tests/integration/ingest-corpus.test.ts tests/contract/concept-doc-chunk-schema.test.ts
```

Expect all chunking/classification tests (Python, no database needed — pure functions
from a markdown file to JSONL lines) and all ingest/idempotency/schema-shape tests
(TypeScript, against a real test Postgres database via the real Prisma client) to pass.
