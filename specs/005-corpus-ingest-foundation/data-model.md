# Data Model: Corpus Ingest Foundation

Additive migration only — `JdSubmission` and `CandidateTrainingDirection` (existing) are
untouched. Two new tables, unrelated to the existing ones, added to `prisma/schema.prisma`.

Both new tables use a **stable, human-meaningful string primary key** rather than this
project's usual `gen_random_uuid()` pattern (used by `JdSubmission`/
`CandidateTrainingDirection`) — a deliberate departure, because `concept_id`/`chunk_id`
themselves must be the durable identifier other rows and future code reference by (spec
FR-004, FR-005; DESIGN.md §12 #2), not an opaque surrogate key.

## `Concept`

Resolves DESIGN.md §13 open decision #5. One row per pattern/technology identity,
independent of whether source material exists for it.

| Field | Prisma type | Column | Notes |
|---|---|---|---|
| `conceptId` | `String @id` | `concept_id` | Lowercase, hyphenated. **Derivation rule (authoritative, spec FR-023):** take the source filename's stem and strip a trailing `-content` or `-pattern` segment if present. Azure's `MicrosoftDocs/architecture-center` repo splits many pattern pages into includable fragment files suffixed `-content` (18 of the 43 pattern files) or, in one case, `-pattern` (`rate-limiting-pattern.md`) — that suffix is a repo-authoring artifact, not part of the pattern's name, and must never leak into `concept_id`. Examples: `cqrs.md` → `cqrs` (no suffix to strip); `retry-content.md` → `retry`; `rate-limiting-pattern.md` → `rate-limiting`. Filename-stripping was chosen over deriving from frontmatter `title` because the `-content`/`-pattern`-suffixed files have **no frontmatter at all** (confirmed by inspection — they're bare fragment files, unlike e.g. `cqrs.md` which has a `title:` field) — a title-based rule would have no value to fall back on for exactly the files that need normalization most. **Never renamed once `status` leaves `candidate`** (FR-004) — enforced by process/tooling, not a DB constraint (Postgres can't express "immutable after a status transition"). Getting this rule right at generation time is a blocking concern: DESIGN.md §12 #2 makes `concept_id` permanent once admitted, so a wrong id reaching `active` status can only be fixed by deprecate-and-re-add, which severs every existing `DocChunk.patternId` foreign key pointing at it. |
| `name` | `String` | `name` | Display name, e.g. `CQRS`. |
| `aliases` | `String[]` | `aliases` | Free-text alternate names/spellings. No uniqueness constraint at the DB level (matches the existing `techStack: String[]` precedent on `JdSubmission`). |
| `kind` | `ConceptKind` | `kind` | `language \| framework \| platform \| architecture \| practice \| tool \| domain` (DESIGN.md §5's seven values). |
| `related` | `String[]` | `related` | Other `concept_id`s. **Not** a DB-enforced foreign-key array — a related id may point at a concept that doesn't exist yet (e.g. two patterns proposed as candidates together, each referencing the other). Matches DESIGN.md §4.2 ③'s framing: "the edges are authored in the documents themselves," not DB-validated. |
| `hasCorpus` | `Boolean @default(false)` | `has_corpus` | Whether at least one `DocChunk` exists for this concept. Set by the ingest tool, not hand-maintained. |
| `embedding` | `Unsupported("vector(1536)")?` | `embedding` | Nullable. **Left null by every tool in this feature** (spec Assumptions) — populated later when `resolve`'s vector fallback (DESIGN.md §8, P1) is built. `vector(1536)` matches `text-embedding-3-small`'s output dimension per DESIGN.md §8, locking in that model choice for whenever it is populated. |
| `status` | `ConceptStatus @default(candidate)` | `status` | `candidate \| active \| deprecated \| rejected`. **Extends DESIGN.md §5's three literal states with a fourth** (`candidate`) to make §9①'s described accept/reject workflow representable — see spec.md's Assumptions for the reasoning. Only `candidate` rows may transition to `active` or `rejected`; only `active` rows may transition to `deprecated`. No other transition is valid (enforced by the admission tool, not a DB constraint — Postgres has no native state-machine check short of a trigger, which is unnecessary complexity for a single-operator batch tool). |
| `addedFrom` | `String` | `added_from` | Provenance, e.g. `seed` for every row this feature generates. Free text, not an enum — DESIGN.md §5 gives `gap:jd-batch-3` as an example of a value shape this feature doesn't need to generate but shouldn't preclude. |
| `createdAt` | `DateTime @default(now()) @db.Timestamptz` | `created_at` | |
| `updatedAt` | `DateTime @updatedAt @db.Timestamptz` | `updated_at` | Tracks the most recent status transition (candidate → active/rejected, or active → deprecated). Not in DESIGN.md's illustrative field list, added for the same reason `JdSubmission` tracks `createdAt` — ordinary auditability, and this row (unlike the append-only `JdSubmission`) actually mutates over its lifecycle. |

```prisma
enum ConceptKind {
  language
  framework
  platform
  architecture
  practice
  tool
  domain
}

enum ConceptStatus {
  candidate
  active
  deprecated
  rejected
}
```

**Table name**: `concepts`

## `DocChunk`

One row per piece of verbatim source text (a full section, or an item-level split within
a cost/benefit/when section).

| Field | Prisma type | Column | Notes |
|---|---|---|---|
| `chunkId` | `String @id` | `chunk_id` | Format `{sourceId}:{conceptId}:{kind}:{slug}`, e.g. `azure:cqrs:cost:eventual-consistency` — `sourceId` is always `azure` for this feature's output. `slug` is a slugified form of the item's bold label (for item-level chunks, FR-009) or the section heading (for section-level chunks) — **not** a positional index. A short content-hash suffix (e.g. the first 6 hex chars of a hash of the chunk's own `content`) is appended only as a collision tiebreaker, for the rare case two distinct items in the same `(conceptId, kind)` slug to the same string. **Why not a positional index** (`...:3`): an index numbered in source-document order is *not* stable under FR-005/spec acceptance scenario 11 — inserting a new item above an existing one, or reordering bullets, would shift every subsequent item's index and silently repoint an existing `chunkId` at different content on the next ingest run (this is exactly the class of failure DESIGN.md §15 question 4 calls out: "does it change chunk boundaries or chunk_ids? → would break sourcing on every question that already exists"). A label-derived slug is stable under reordering and under edits elsewhere in the file; if a label itself is edited, the `chunkId` changing is the *correct* outcome (a new chunk, not a silently repurposed old one) — see research.md §5 for the full reasoning. |
| `patternId` | `String` | `pattern_id` | FK → `Concept.conceptId`. The referenced `Concept` row must already exist (in any status, including `candidate`) before a `DocChunk` referencing it is inserted — the ingest tool upserts a pattern's candidate `Concept` row before its `DocChunk` rows, within the same transaction. `onDelete: Restrict` (a `Concept` is never hard-deleted per DESIGN.md §12 #2's spirit, so cascading behavior should never actually trigger). |
| `kind` | `ChunkKind` | `kind` | `cost \| benefit \| when \| example \| meta \| unmapped`. `unmapped` is this data model's answer to spec FR-020/021: an unclassified section is still stored (never silently dropped), just flagged, and also surfaced in the unmapped-headings report by heading text. |
| `label` | `String` | `label` | Section heading text, or (for an item-level chunk) the bold label from its bullet (e.g. `Eventual consistency`). |
| `content` | `String` | `content` | **Verbatim source text only — never the contextual prefix.** Independently verifiable byte-for-byte against the source file (SC-001) with zero carve-outs. This is the field a future verbatim-verification step checks with `content.includes(verbatim)` (DESIGN.md §4.2 ⑥); keeping the prefix out of it is what makes that check trustworthy — see `contextPrefix` below. |
| `contextPrefix` | `String` | `context_prefix` | The contextual prefix (FR-013/FR-013a), e.g. `[CQRS pattern / Problems and considerations]` for a section-level chunk, or, for an H3 chunk, the **full ancestor chain** — e.g. `[CQRS pattern / Combine the Event Sourcing and CQRS patterns / Considerations for how to combine the Event Sourcing and CQRS patterns]`, not just the H3's own heading — stored **separately** from `content` rather than pre-concatenated into it. A future `generate` step (DESIGN.md §4.2 ⑤, not built by this feature) concatenates `contextPrefix + content` at prompt-assembly time. Storing them separately, rather than concatenating at ingest time as originally planned, closes a real sourcing-integrity gap: with the prefix inside `content`, a verbatim citation spanning into the prefix (e.g. `"[CQRS pattern / Problems and considerations] When the read databases..."`) would still pass an `includes()` check against `content` — because the prefix genuinely is in `content` — while citing text this pipeline synthesized, not the source document. That's a silent sourcing failure of exactly the class DESIGN.md §12 #1 and #3 exist to prevent, and `content`/`SC-001` alone (an ingest-time integrity check) would never catch it. |
| `sourceUrl` | `String` | `source_url` | The permalink form already used in `corpus/_meta/manifest/azure.jsonl` (GitHub blob URL pinned to the fetch's commit sha). |
| `citable` | `Boolean` | `citable` | Copied from the source manifest's license tier (FR-018) — `true` for every azure chunk (CC-BY-4.0). Stored per-row rather than looked up via a join so a downstream consumer never needs to know about license tiering to render a citation correctly. |
| `kindConfidence` | `KindConfidence` | `kind_confidence` | `regex \| llm \| manual`. Always `regex` for this feature's output (FR-019) — the column exists so a future prose-source feature (DESIGN.md §7.7, `llm`-confidence chunks) can share this table without a schema change. |
| `docDate` | `DateTime? @db.Timestamptz` | `doc_date` | From the source file's frontmatter (`ms.date`) where present; null otherwise. |
| `contentHash` | `String` | `content_hash` | The source file's `sha256` (from `corpus/_meta/manifest/azure.jsonl`) at the time this chunk was produced — used by the ingest tool to detect unchanged files and skip them (research.md §5), and to know which existing rows to delete-and-replace when a file *has* changed. |
| `createdAt` | `DateTime @default(now()) @db.Timestamptz` | `created_at` | |
| `updatedAt` | `DateTime @updatedAt @db.Timestamptz` | `updated_at` | Set when a file changes and its chunks are replaced. |

```prisma
enum ChunkKind {
  cost
  benefit
  when
  example
  meta
  unmapped
}

enum KindConfidence {
  regex
  llm
  manual
}
```

**Table name**: `doc_chunks`
**Indexes**: `@@index([patternId])` (per-pattern retrieval — this is exactly the access
pattern DESIGN.md §4.2 ④'s `retrieve` step will use, `WHERE pattern_id = ANY($1)`, once
Feature B builds it); `@@index([contentHash])` (ingest's per-file change lookup).

## Validation rules carried over from spec.md

- FR-004 / FR-005 (identifier stability) — process rule, not enforceable as a DB
  constraint; the admission tool and ingest tool are each responsible for never issuing an
  `UPDATE` that changes a `conceptId` or `chunkId` value, only inserts/deletes of whole
  rows.
- FR-014 (no rewriting source text) — not a DB-level rule at all; it constrains what the
  chunking tool is permitted to write into `content` in the first place. SC-001 is how
  this gets verified (substring check against the source file), not a schema constraint.
- FR-024 / FR-025 (candidates never auto-admitted) — enforced by `status`'s default
  (`candidate`) and by there being no code path in this feature that writes `status:
  active` except the explicit admission tool acting on an explicit human decision.

## State transitions (`Concept.status`)

```
candidate ──(human accepts)──> active ──(human supersedes with a new concept_id)──> deprecated
    │
    └──(human rejects)──> rejected
```

No transition out of `active` back to `candidate`; no transition out of `deprecated` or
`rejected` at all within this feature's scope (both are terminal here — DESIGN.md doesn't
describe "un-rejecting" a candidate, and re-running candidate generation for an already
rejected pattern is explicitly a no-op per spec FR-026, not a resurrection).
