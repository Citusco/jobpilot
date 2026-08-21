# Quickstart: Corpus Structure Rebuild

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-10

Five steps across three components in two languages, one of which is a service that must be
running. The order matters and getting it wrong produces confusing failures rather than clear
ones — running ingest before the chunker loads the previous run's output and looks like it worked.

## Prerequisites

```
Postgres running, DATABASE_URL set in .env at the repo root
JOBPILOT_CORPUS_RAW pointing at the shared corpus, outside any worktree
corpus/_meta/candidates/azure.jsonl present -- tracked
AWS credentials able to read the secret agent-service uses, for step 4 only
```

**Set `JOBPILOT_CORPUS_RAW` before anything else.** It points at the raw corpus, which lives
outside the repository on purpose: kept inside a worktree it is invisible to `git status`, so
tooling that reclaims a worktree with "no uncommitted changes" takes it with no warning. That is
how 326 MB was lost on 2026-08-21. One shared copy also means worktrees stop each fetching their
own.

```bash
export JOBPILOT_CORPUS_RAW=D:/aieng/jobpilot-corpus
```

Unset, it falls back to `corpus/raw/` inside the tree, which works but reintroduces the hazard.

## 0. Fetch sources, only if `corpus/raw/azure/` is missing

```bash
python corpus/tools/fetch_git.py --source azure
```

Verify the file count before continuing — 58 markdown files under `corpus/raw/azure/`, of which
49 become concepts. A short count here silently becomes a short corpus later.

## 1. Migrate

```bash
npx prisma migrate dev --name corpus_structure_rebuild
```

This truncates `doc_chunks`. That is intended: `kind` and `kind_confidence` are dropped, every
`chunk_id` changes anyway, and every row is reproducible from the source layer. `concepts` is
preserved — `concept_id` is never renamed.

Confirm afterwards that `concept_terms` exists, `concepts.aliases` is gone, and the `ChunkKind`
and `KindConfidence` types no longer exist.

## 2. Chunk

```bash
python corpus/tools/chunk_azure.py
```

Writes `corpus/_meta/chunks/azure.jsonl` (gitignored). The build prints a coverage report; check
it before loading anything:

```
concepts            49
sections           490
after splitting   ~571        65 sections over the 3,000-char cap
coverage       775,008 / 775,008 = 100.0000%      unclaimed 0
chunk_id       571 distinct, 0 collisions
```

**Coverage below 100% means stop.** Not a warning to note and move past — it is the exact defect
this feature exists to close, and loading an incomplete corpus buries it. The build should fail
on its own here; if it printed a shortfall and continued, that is itself a bug.

Two sanity checks worth doing by eye the first time:

- A preamble chunk exists for every document, with `headingPath` of length 1. Previously this
  text never entered the pipeline at all — 49 of 49 files, 29,251 characters.
- Sections whose headings used to be unrecognised — `Solution`, `Example`, `Workload design`,
  `Context and problem` — are present. Together they were the bulk of the 69% that was discarded.

## 3. Ingest

```bash
npx tsx scripts/ingest-corpus.ts
```

Loads chunks and concepts, expands `concept_terms`, and creates the candidate concepts that
`related` edges point at. No provider call yet, so this step is verifiable on its own.

```
chunks         ~571
terms           124        2.5 per concept, 0 cross-concept collisions
concepts         69        49 with material + 20 candidates without
```

If two concepts produce the same normalised phrase, ingest lists **every** collision and then
fails. Fix `corpus/_meta/candidates/azure.jsonl` and re-run; ingest is idempotent, so a partial
first attempt is not a problem.

## 4. Embed

Start the agent service first — this is the step people forget, because the rest of the build is
offline:

```bash
cd agent-service && uv run uvicorn agent_service.main:app --port 8000
```

Then, from the repo root:

```bash
npx tsx scripts/ingest-corpus.ts --embed
```

```
vectors         69        dimensions 1536, model text-embedding-3-small
positive baseline   p10  0.xx
negative baseline   p90  0.xx
```

Those two numbers are the point of this step beyond the vectors themselves. They are the evidence
for whether the current representation separates this concept set:

- **Well separated** — the positive p10 sits clearly above the negative p90. 1536 dimensions of
  `text-embedding-3-small` are adequate; the question is closed.
- **Overlapping** — no threshold can be chosen that does not either miss real matches or admit
  false ones. That is the recorded trigger for trying `text-embedding-3-large`, and it costs one
  migration plus seconds of recomputation for ~70 vectors.

Do not pick a threshold here. This feature produces the distributions; calibration happens when
something actually resolves against them.

## 5. Verify

```bash
npm run typecheck && npm run lint && npm run test
```

```bash
cd corpus/tools && python -m pytest tests/
cd agent-service && uv run pytest
```

The assertions that matter most, and why:

| Assertion | Catches |
|---|---|
| Byte coverage is total | Both defects this feature fixes. It is the single test that would have caught the 69% loss and the never-ingested preambles |
| Term uniqueness over the candidate files | A phrase claiming two concepts, without needing a database |
| Idempotency | A second run duplicating rows instead of updating them |
| `chunk_id` stability across two runs | Non-reproducible boundaries, which would silently break verbatim verification |

## Rebuilding from scratch

```bash
npx prisma migrate reset
python corpus/tools/chunk_azure.py
npx tsx scripts/ingest-corpus.ts
npx tsx scripts/ingest-corpus.ts --embed
```

Safe at any time. Nothing in the database is authored — the concept records live in
`corpus/_meta/candidates/azure.jsonl` under version control, and everything else derives from the
source layer.
