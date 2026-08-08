# Research: Corpus Ingest Foundation

## §1: How should chunked azure content reach Postgres?

**Decision (revised)**: Move the seam between text processing and database writes, rather
than putting it at a network boundary. `corpus/tools/chunk_azure.py` (Python) reads
`corpus/raw/azure/`, applies the chunking/classification rules, and writes two JSONL files
— no database connection anywhere in Python. A new TypeScript script,
`scripts/ingest-corpus.ts`, reads those JSONL files and performs the actual
insert/update/delete against `Concept`/`DocChunk` through the **Prisma client NestJS
already generates from `prisma/schema.prisma`** — the same client, the same schema, the
same generated types. `ingest_azure.py` and `db.py` (this research note's earlier plan) are
no longer needed, and `psycopg2-binary` is no longer a dependency anywhere in this feature.

**Rationale**: This decision was previously "the Python tool opens a direct `psycopg2`
connection to Postgres" (see the rejected alternative below for that reasoning, which was
sound as far as it went) — but that plan required a hand-maintained Python script to stay
in agreement with a schema authored and generated on the TypeScript side, with nothing
that fails at compile time when the two drift. Prisma's generated client is checked
against the schema it owns; writing through it instead of through raw SQL turns "the
Python script's column names must match Prisma's `@map` output" from a convention someone
has to remember into a property the type system enforces. It also makes the
Constitution-IV judgment call in the rejected `psycopg2` decision below moot rather than
merely well-argued: with no Python process touching Postgres at all, there's no "is this
offline tooling exempt from the agent-orchestration-service database rule" question left
to answer. And the JSONL intermediate is worth having on its own terms — chunk output
becomes inspectable and diffable before it ever reaches the database, ingest logic can be
iterated on without re-running the (slower, corpus-wide) chunking pass, and it resolves an
ambiguity plan.md's Testing section previously papered over ("a temp Postgres or a stub
connection" for testing ingest logic): chunking tests now need no database at all (pure
function of a markdown file to a JSONL file), and ingest tests exercise real Prisma
Client calls against a real (test) database, which is what a Prisma-based test suite
should do anyway. This also matches the shape every other `corpus/tools/` step already
uses (`fetch_git.py` → raw files, `build_manifest_git.py` → `azure.jsonl`, `filter_md.py`
→ filtered raw files) — a file each step reads and writes, not an in-process handoff.

**Rejected alternative — direct `psycopg2` connection from Python (the plan this
supersedes)**: `corpus/tools/` opens a direct connection to the same Postgres instance via
`DATABASE_URL` and writes with plain parameterized SQL. The Constitution-IV reasoning for
why this wouldn't have been a violation was: Principle IV's "Python does not connect to the
database" constraint (echoed in DESIGN.md §4.1) is written in the context of **the agent
orchestration service** specifically — a deployed FastAPI process talking to NestJS over an
explicit HTTP boundary as part of the live request-serving pipeline — and `corpus/tools/`
is neither deployed, nor FastAPI/LangGraph/LangChain, nor has any runtime relationship to
`agent-service/`; it's an offline batch job, structurally closer to a seed script than a
service. That argument still holds as a defense, which is exactly the problem the revised
decision above solves: a defense is still a judgment call someone has to re-litigate later,
where routing writes through Prisma removes the need for one. Superseded, not because the
reasoning was wrong, but because a better option existed and wasn't considered until this
revision.

**Alternatives considered** (unchanged from the original decision, still rejected under
the revised plan for the same reasons):
- **Add a `POST /internal/corpus/ingest` NestJS endpoint and have a Python tool call
  it.** Rejected: this is exactly the kind of "introduce a service boundary because a
  rule says Python-and-database-don't-mix" reasoning DESIGN.md §15's evaluation framework
  warns against — the ambiguity here isn't naturally at a service boundary (§8's map of
  ambiguity), it's a deterministic bulk write. It would also add a real HTTP endpoint, its
  request/response contract, and its own Full-SDD service-boundary review, and would make
  ingestion depend on a running NestJS process for what is otherwise a local batch job —
  strictly worse than the chosen option, which needs no running service on either side of
  the JSONL handoff.
- **Do the chunking in TypeScript too, instead of Python.** Rejected: DESIGN.md §4.5 and
  the corpus-build feature already established Python (with a local venv) as
  `corpus/tools/`'s language for text-processing batch work, and regex-based markdown
  parsing isn't meaningfully easier or safer in TypeScript. The revised plan keeps this
  split cleanly — Python does text processing (chunking, classification), TypeScript does
  database writes (ingest) — rather than picking one language for both halves.

## §2: Does this feature need a `contracts/` artifact?

**Decision**: No.

**Rationale**: `contracts/` documents an external interface — an HTTP endpoint (spec 002's
`openapi.yaml`) or similar. This feature adds no HTTP endpoint (§1) and no public
function/library surface consumed by another service. `corpus/tools/chunk_azure.py`
(Python) and `scripts/ingest-corpus.ts` (TypeScript) are each operated directly by a human,
and their usage/flags are self-documenting via `--help` — exactly the pattern every
existing `corpus/tools/` script (`fetch_git.py`, `fetch_html.py`, `filter_md.py`,
`structure_probe.py`) already uses without a separate contracts file. The JSONL file
the two scripts hand off through (`corpus/_meta/chunks/azure.jsonl`) is an internal
implementation seam within this single feature, not an interface exposed to another
service or consumer — §3 documents its shape as part of this feature's own design, which
is a different thing from a `contracts/` artifact.

**Alternatives considered**: A written CLI-flags contract doc was considered for
consistency with spec 002's precedent, but rejected as pure overhead — none of the
existing five `corpus/tools/` scripts have one, and this feature's tools should match that
established local convention rather than import a pattern from a different kind of
feature (an HTTP-exposing one).

## §3: JSONL schema — what `chunk_azure.py` emits per line

Superseded topic: this section previously covered Postgres driver choice for a Python
ingest tool (`psycopg2-binary` vs. `asyncpg` vs. an ORM). That question no longer applies
— per §1's revised decision, no Python code connects to Postgres at all. What Python needs
to get right instead is the shape of the two JSONL files it hands off to
`scripts/ingest-corpus.ts`.

**Decision**: Two JSONL files, one line per record, matching `doc_chunk`'s and
`concept`'s columns from `data-model.md` directly (so `ingest-corpus.ts` can map a parsed
line onto a Prisma `create`/`upsert` call with no further transformation):

`corpus/_meta/chunks/azure.jsonl` — one line per `DocChunk` candidate row:

```json
{
  "chunkId": "azure:cqrs:cost:eventual-consistency",
  "patternId": "cqrs",
  "kind": "cost",
  "label": "Eventual consistency",
  "content": "When the read databases and write databases are separated, the read data might not show the most recent changes...",
  "contextPrefix": "[CQRS pattern / Problems and considerations]",
  "sourceUrl": "https://github.com/MicrosoftDocs/architecture-center/blob/<sha>/docs/patterns/cqrs.md",
  "citable": true,
  "kindConfidence": "regex",
  "docDate": "2025-02-20",
  "contentHash": "<sha256 of the source file, from corpus/_meta/manifest/azure.jsonl>",
  "sourceFile": "docs/patterns/cqrs.md"
}
```

`corpus/_meta/candidates/azure.jsonl` — one line per `Concept` candidate row (49 lines,
one per concept-eligible file — spec.md SC-005):

```json
{
  "conceptId": "retry",
  "name": "Retry",
  "kind": "architecture",
  "aliases": [],
  "related": ["circuit-breaker"],
  "addedFrom": "seed",
  "sourceFile": "docs/patterns/retry-content.md"
}
```

`docDate` is `null` when the source file has no frontmatter date (e.g. every
`-content`/`-pattern`-suffixed file — see data-model.md's `conceptId` row, which already
established these files have no frontmatter at all). `sourceFile` (present on both record
types, relative to `corpus/raw/azure/`) is what lets `ingest-corpus.ts` group chunk rows by
source file for the per-file `contentHash` skip/replace decision (research.md §5) without
needing to parse it back out of `chunkId`.

**Rationale**: Field names match the Prisma model's camelCase field names exactly (not the
`@map`-generated snake_case column names) so `ingest-corpus.ts` can spread a parsed JSON
line straight into a `prisma.docChunk.create({ data: ... })` call — Prisma Client handles
the camelCase-to-snake_case column mapping itself, so there is no manual name-translation
step for `ingest-corpus.ts` to get wrong. Two separate files rather than one
polymorphic file (a `recordType` discriminator mixing chunk and candidate rows) keeps each
file's shape uniform and lets `ingest-corpus.ts` parse each with a single, non-branching
Zod schema per file.

**Alternatives considered**: A single JSONL file with a `recordType: "chunk" |
"candidate"` discriminator — rejected, it would make every consumer (including a human
skimming the file, or a future diff between two runs) branch on type for no real benefit,
when two files with fixed, uniform shapes are just as easy to produce and easier to read.
CSV instead of JSONL — rejected, `content`/`contextPrefix` are free-text fields containing
newlines, quotes, and markdown syntax that CSV escaping handles worse than JSON string
escaping does, and JSONL is already this project's established interchange format for
`corpus/tools/` (the manifest files from the corpus-build feature are JSONL for the same
reason).

## §4: Dependency management for `corpus/tools/`

**Decision (still needed, narrower than before)**: A plain `corpus/tools/requirements.txt`,
installed into the existing `corpus/.venv/` with `pip install -r`. Not a `pyproject.toml` +
`uv.lock` setup like `agent-service/`. Per §1's revised decision, `psycopg2-binary` is no
longer part of this — `chunk_azure.py` needs only `pyyaml` (already a `corpus/tools/`
dependency from the corpus-build feature) and, newly, `pytest` for its test suite (§1's
chunking tests need no database, so this is the only genuinely new Python dependency this
feature adds).

**Rationale**: A `requirements.txt` is still worth adding regardless of how small the
dependency list ends up — `corpus/.venv/` was bootstrapped with a plain `python -m venv` in
the corpus-build feature and never given a pinned requirements file, so this feature closes
that gap either way. `agent-service/`'s `uv`/`pyproject.toml` setup is for a deployed
service with real dependency-resolution needs; `corpus/tools/` remains a handful of
standalone scripts sharing one local venv, and that shape (and this section's conclusion)
is unchanged by moving the database write path out of Python — if anything, a smaller
dependency list makes the case for staying with a plain `requirements.txt` (rather than
`uv`) stronger, not weaker.

**Alternatives considered**: Matching `agent-service/`'s `uv`/`pyproject.toml` pattern for
consistency — rejected as disproportionate to `corpus/tools/`'s actual shape (no package
to build, no service to deploy, nothing importing it as a library) — now more clearly so,
with even less dependency surface to manage than the original plan had.

## §5: `content_hash` idempotency mechanism

**Decision**: Reuse the `sha256` value already computed per file in
`corpus/_meta/manifest/azure.jsonl` (written by the corpus-build feature's
`build_manifest_git.py`) as each file's `content_hash` (`contentHash` in the §3 JSONL
schema). `chunk_azure.py` always re-chunks every file on every run and always writes a
`contentHash` for each resulting line — chunking itself is cheap, local, and side-effect
free, so there's no reason to skip it. The idempotency check happens on the write side
instead: for each distinct `sourceFile` in the JSONL, `scripts/ingest-corpus.ts` compares
the incoming `contentHash` against what's already recorded on that file's existing
`DocChunk` rows in Postgres. If it matches, that file's rows are left untouched entirely
(true no-op, spec SC-002). If it differs (or the file is new), all existing `DocChunk` rows
for that file are deleted and replaced, in one Prisma transaction, with the freshly chunked
set from the JSONL.

**Rationale**: The manifest's `sha256` is already a hash of the exact same bytes the
chunker would read — recomputing an independent hash would either produce the same value
redundantly or risk drifting out of sync with the manifest's own provenance record for no
reason. Delete-and-replace-per-file (rather than row-by-row diffing) is simpler to reason
about and matches DESIGN.md §9②'s own framing ("`content_hash` skips files that haven't
changed") — the unit of change tracking is the file, not the individual chunk.

**Alternatives considered**: Row-level upsert keyed on a hash of each chunk's own content
(rejected — a clean row-level diff is more complexity than a batch job needs when
"the file changed" is already a good enough unit of change tracking; note this
consideration is orthogonal to `chunk_id` stability, which data-model.md's `chunkId` row
now handles separately via label-derived slugs rather than position — an earlier draft of
this decision conflated the two and reasoned from a positional `chunk_id` scheme that was
since replaced specifically because it failed FR-005 under mid-file edits, see
data-model.md); recomputing a fresh hash independently of the manifest (rejected —
redundant, see Decision).

## §6: Corpus measurements — what the azure corpus actually looks like under this spec's rules

DESIGN.md §7.5's own lesson is that chunking decisions must rest on observed raw data, not
assumptions about document structure. This section records what running this spec's own
classification rules over the real, already-fetched `corpus/raw/azure/` (the 49
concept-eligible files — spec.md SC-005) actually produces, because two of DESIGN.md's own
claims turn out not to hold, and writing that down here is what stops a future reader from
re-deriving the same wrong conclusions from DESIGN.md alone.

### Heading coverage (441 H2+H3 headings across the 49 files)

| Outcome | Count | Share |
|---|---:|---:|
| `meta` | 86 | 19.5% |
| `example` | 81 | 18.4% |
| `cost` | 50 | 11.3% |
| `when` | 47 | 10.7% |
| `benefit` | 9 | 2.0% |
| `unmapped` | 168 | 38.1% |

Of the 168 unmapped, 86 (51%) are just `Context and problem` (43 occurrences — one per
file, it's a template section every pattern page has) and `Solution` (43 occurrences,
same) — both legitimate template sections that correctly don't match any tradeoff kind.
The remaining 82 are a long tail of one-off implementation headings (flow steps, function
names, "Components," "Workflow," and similar). **Unmapped is not evidence of a
classification gap here** — it's dominated by two headings that were never supposed to
match anything.

### Contradiction 1 — H3 splitting recovers a few headings, not "the benefit dimension"

DESIGN.md §7.5 states benefit content is mostly at H3 and that splitting to H3 "recovers"
it. Measured: splitting on H2+H3 yields only 9 `benefit` headings total corpus-wide, of
which only 3 are at H3 (`cqrs.md`'s "Benefits of CQRS" and "Benefits of combining the Event
Sourcing and CQRS patterns," and `messaging-bridge-content.md`'s "Benefits" — which is
actually H3 nested under `## Solution` there too). The other 6 (all 6 architecture-style
files' plain "Benefits" heading) are at H2 and were never at risk of being lost by an
H2-only split. **The real cause is structural, not a heading-level splitting problem**:
Azure's pattern template (`Context and problem` / `Solution` / `Problems and
considerations` / `When to use this pattern`) simply has no benefits section in the
overwhelming majority of pattern files (see "Shape of the gap," below). SC-004 still
passes on its literal wording (at least one benefit chunk is recovered from H3 content that
an H2-only count would have missed), but that pass should not be read as evidence the
benefit gap itself is closed — it isn't, and FR-006 above has been reworded to not
overclaim this.

### Contradiction 2 — aspnet's "buried gold" templates don't carry a benefit section either

DESIGN.md §7.2 lists aspnet's breaking-change and code-analysis templates as high-value
"buried gold" worth including in a future pass. Re-measured directly against
`corpus/raw/aspnet/` (1685 files) for this research note — **on the same H2+H3, code-fence-
protected basis as every other count in this section** (the 441 total headings, all six
`kind` counts, the 106 tradeoff chunks all split on both `##` and `###` per FR-006, so this
table does too; stated explicitly because an earlier pass at this table silently used an
H2-only count, which understated exactly the headings that have real H3 occurrences —
reproducing, inside the section written to record it, the same failure mode DESIGN.md
§7.5 documents about its own earlier H2-only heading-frequency report):

| Heading | Occurrences (files) |
|---|---:|
| Additional resources | 504 (424) |
| Prerequisites | 161 (141) |
| Next steps | 146 (138) |
| Affected APIs | 155 (110) — 30 of these are at H3; an H2-only count reads 125 |
| Reason for change | 111 (111) |
| Recommended action | 111 (111) |
| Version introduced | 110 (110) |
| New behavior | 107 (107) |
| Previous behavior / Type of breaking change / Cause / How to fix violations / When to suppress warnings | 56 each (56 each) |
| Rule description | 56 (56) — 20 of these are at H3; an H2-only count reads 36 |

These are the same headings `corpus/reports/structure-probe.md` recorded from the
corpus-build feature, re-confirmed here by an independent, fence-protected, H2+H3 re-count
over the same files (`structure-probe.md` itself is H2-only, by design — task D of the
corpus-build feature scoped it that way before this feature's H2+H3 chunking rule
existed; it is not wrong for its own purpose, just not the basis to reuse here without
re-measuring). The conclusion is unaffected by which basis is used: aspnet supplies `when`
in real volume — "When to suppress warnings" is a genuine conditional-judgment section
(56 files' worth) — but nothing in its recurring-heading list is benefit-bearing.
**Adding aspnet would not close the benefit gap**, on either basis.

### Shape of the benefit gap — confined to the pattern corpus, not uniform

```
architecture-styles (6 files): benefit present in 6/6, cost present in 6/6,
  when present in 5/6 (microservices.md has no "When to use" section)
  -> 5 of 6 files have all three kinds

patterns (43 files): only cqrs.md and messaging-bridge-content.md carry
  any benefit heading at all
  -> 41 of 43 pattern files have zero benefit content
```

Exactly 7 of the 49 concept-eligible files have all three ingredient kinds (benefit + cost
+ when): `cqrs`, `messaging-bridge-content`, `big-compute`, `big-data`, `event-driven`,
`n-tier`, `web-queue-worker`.

**Consequence worth stating plainly, since it affects a later feature and not this one**:
a complete question option (per DESIGN.md's product form, §2) needs all three of
benefit/cost/when for an option. 42 of the 49 concepts this feature produces cannot
currently support a complete option and will fall to DESIGN.md §9③(a)'s degraded
generation path (drop the option, ask a two-option question) whenever `generate` is built.
The useful corollary: the 7 complete files are sufficient to validate the *online pipeline
end-to-end* once it's built — the benefit gap limits corpus coverage breadth, not the
ability to prove the pipeline works.

### Deferred decision — do not solve the benefit gap here

Three options exist for eventually closing it:

- **(a)** Accept degraded (two-option) generation for the 42 affected concepts, per
  DESIGN.md §9③(a) — the already-designed default.
- **(b)** Apply DESIGN.md §7.7's deterministic-boundary/LLM-labeling approach (built for
  prose sources, not azure) to azure's own `## Solution` prose, where benefit statements
  for the 41 gap-affected pattern files actually seem to live in running text rather than
  a dedicated heading.
- **(c)** Bring in microservices.io, whose classic pattern-language template does carry
  explicit `Benefits`/`Drawbacks` sections — but it's `citable: false` (confirmed in the
  corpus-build feature via a footer copyright scan), so §7.4's license tiering permits it
  as LLM reference material but not as displayed verbatim text, which would require a
  fourth grounding tier beyond §10's three (`grounded`/`ungrounded`/`unavailable`) — not a
  small addition.

Per DESIGN.md §11 ("get it running first, then make it good"), none of these should be
chosen before the online pipeline has actually run and produced measurable evidence that
`benefit = null` questions are materially worse than complete ones — building any of (a
non-default)/(b)/(c) now would be exactly the kind of pre-building without evidence §15
question 5 warns against. **Trigger condition, written down so it isn't lost**: after the
online pipeline runs against the planned 5-10 JD benchmark (§7.8), if the share of
generated options with `benefit = null` exceeds 60% *and* blind review judges those
questions materially weaker than complete ones, bring options (a, as a non-default)/(b)/(c)
to the table for a decision. Until then, (a) — the already-designed default — is what
ships.
