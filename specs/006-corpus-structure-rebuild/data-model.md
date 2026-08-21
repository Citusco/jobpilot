# Data Model: Corpus Structure Rebuild

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-10

One migration. Three entities change: `Concept` loses a field, `DocChunk` is reshaped,
`ConceptTerm` is new. Two enums are dropped.

## `ConceptTerm` — new

One row per phrase that identifies a concept. The whole table is a single namespace.

```prisma
enum TermType {
  id
  name
  title
  alias
}

model ConceptTerm {
  term        String   @id                     // normalized; see normalizeTerm below
  displayTerm String   @map("display_term")    // as authored, for inspection only
  conceptId   String   @map("concept_id")
  termType    TermType @map("term_type")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz

  concept Concept @relation(fields: [conceptId], references: [conceptId], onDelete: Cascade)

  @@index([conceptId])
  @@map("concept_terms")
}
```

**Why `term` alone is the primary key.** The rule this table enforces is *one phrase identifies
one concept*. That is a cross-row constraint, which a Postgres `CHECK` cannot express, and which
as application logic is a step someone can skip or regress. As a single-column primary key over
a namespace that holds ids, names and aliases together, it cannot be violated: an alias that
collides with another concept's name is a duplicate key and the load fails.

A composite key would not do the job. `(concept_id, term_type)` allows only one alias per
concept and permits two concepts to claim the same phrase. `(term, concept_id)` permits the same
phrase to claim two concepts, which is exactly what must not happen.

**Direction of the constraint.** One term → one concept. One concept → many terms. `concept_id`
repeats freely in this table; that is the intended shape.

**`onDelete: Cascade`**, unlike `DocChunk`'s `Restrict`: a term has no independent existence, so
removing a concept should take its terms with it. Source material is different — deleting a
concept out from under stored chunks should be refused.

**`displayTerm` is not for display.** The user-facing name is `Concept.name`. Because
normalization strips separators, `term` is unreadable (`webqueueworker`); `displayTerm` exists so
that a person debugging a bad resolution can see what was actually written.

### Normalization

```ts
// src/corpus/normalize-term.ts -- the only implementation
export function normalizeTerm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
```

Strips rather than collapses. Measured over the 49 concepts both variants give 50 terms and zero
collisions, but stripping additionally unifies concatenated and separated spellings —
`anti-corruption-layer` and `anticorruption layer` both become `anticorruptionlayer` — which
removes a class of variant that would otherwise have to be written by hand.

Both the writer and every reader must call this same function. Two implementations that drift
produce lookups that return nothing, with no error.

### Population

Mechanical, no hand annotation. Per concept:

| Source | `termType` | Example |
|---|---|---|
| `conceptId` | `id` | `queue-based-load-leveling` |
| `Concept.name` | `name` | `Queue-Based Load Leveling` |
| H1 or frontmatter `title` | `title` | `Queue-Based Load Leveling pattern` |
| name with a trailing `pattern` added or removed | `title` | `Queue-Based Load Leveling pattern` |

`alias` is reserved and unused. Hand-authored aliases are deferred until a measurement shows
which category automatic resolution fails on; reserving the value means adding them later is a
data change, not a schema change.

**Deduplication rules.** Within one concept, duplicates after normalization are dropped silently,
keeping the highest-precedence origin in the order `id > name > title > alias`. This is the
common case, not an edge case — nearly every concept's id and name normalize identically
(`cqrs` / `CQRS`). Across concepts, a duplicate is fatal: the load reports every collision and
then fails, rather than stopping at the first.

Measured: 124 terms over 49 concepts, 2.5 per concept, zero cross-concept collisions.

## `Concept` — one field removed, one relation added

```diff
 model Concept {
   conceptId String        @id @map("concept_id")
   name      String
-  aliases   String[]
   kind      ConceptKind
   related   String[]
   hasCorpus Boolean       @default(false) @map("has_corpus")
   embedding Unsupported("vector(1536)")?
   status    ConceptStatus @default(candidate)
   addedFrom String        @map("added_from")
   ...
   chunks DocChunk[]
+  terms  ConceptTerm[]
 }
```

`aliases` moves to `ConceptTerm`, where the uniqueness rule can be enforced. An array cannot
enforce anything, and `WHERE $1 = ANY(aliases)` is a scan where the new table is a primary-key
lookup.

`embedding` already exists and is unpopulated; this feature populates it. Dimensionality stays
1536 — at this scale it is not a cost variable (~70 vectors), and truncating would cost exactly
the near-synonym resolution this corpus needs, `throttling` versus `rate-limiting` being the
worked example.

### New rows: concepts known but without material

`related` currently holds 34 references to 20 concepts that were never ingested — `messaging`,
`caching`, `ci-cd`, `high-performance-computing` and others outside `docs/patterns/`. They become
rows with `status = candidate`, `hasCorpus = false`, `addedFrom = "related-edge"` and no chunks.

This is the state the two-table model was designed for: *known but no material yet*, as opposed
to never heard of. Creating them also repairs 3 of the 7 currently isolated concepts
(`big-compute`, `cache-aside`, `big-data`), whose only `related` targets were these missing rows.

Their vectors are computed from name and terms alone, since they have no definition text. Those
vectors are weaker, which is correct — they are placeholders, and when material is admitted the
vector is recomputed.

## `DocChunk` — reshaped

```diff
 model DocChunk {
   chunkId        String         @id @map("chunk_id")
   patternId      String         @map("pattern_id")
-  kind           ChunkKind
-  label          String
-  contextPrefix  String         @map("context_prefix")
-  kindConfidence KindConfidence @map("kind_confidence")
+  headingPath    String[]       @map("heading_path")
+  parentChunkId  String?        @map("parent_chunk_id")
+  sourceOffset   Int            @map("source_offset")
+  sourceLength   Int            @map("source_length")
+  embedding      Unsupported("vector(1536)")?
   content        String
   sourceUrl      String         @map("source_url")
   citable        Boolean
   docDate        DateTime?      @map("doc_date") @db.Timestamptz
   contentHash    String         @map("content_hash")
   ...
   concept Concept  @relation(fields: [patternId], references: [conceptId], onDelete: Restrict)
+  parent  DocChunk?  @relation("ChunkChildren", fields: [parentChunkId], references: [chunkId], onDelete: Cascade)
+  children DocChunk[] @relation("ChunkChildren")

   @@index([patternId])
   @@index([contentHash])
+  @@index([parentChunkId])
 }
```

```prisma
- enum ChunkKind { cost benefit when example meta unmapped }
- enum KindConfidence { regex llm manual }
```

**What each removal costs, and why nothing is lost.** `kind` was a filter that discarded 69% of
body text and then reported the discarded material as missing; it is not preserved even as a
display label, because `headingPath`'s last element (`Problems and considerations`) carries more
information than the enum value (`cost`) would. `label` was that last element already.
`contextPrefix` was a string assembled from ancestor headings — `headingPath` is the same
information, structured, and unlike the prefix it is never concatenated into `content`.
`kindConfidence` described how `kind` was derived and has nothing left to describe.

**`embedding` is created and left empty.** Chunk-level retrieval is deferred: a concept's entire
material averages ~3,700 tokens against a generation budget above 128,000, so there is nothing to
compress, and top-k selection is structurally the same operation as the filter just abolished.
The column exists now so that enabling it later is a data change.

### Invariants

These are what the tests assert.

1. **Total coverage.** For each source document, the `[sourceOffset, sourceOffset + sourceLength)`
   spans of its chunks partition the post-frontmatter text: no gap, no overlap, nothing
   unclaimed. Measured for the new scheme: 775,008 of 775,008 bytes, exactly 100.0000%. The
   current pipeline claims 27%.
2. **Content is the span.** `content` equals the source text at that span exactly. Nothing is
   prepended, appended or rewritten — this is what makes verbatim verification meaningful, and
   SCRUM-42 shipped a defect where the context prefix was concatenated into `content`.
3. **Parent–child spans nest.** A child's span lies within its parent's, and a parent's children
   together cover the parent's span exactly.
4. **Determinism.** Two builds from unchanged sources produce identical ids, spans and counts.
5. **`headingPath[0]`** is the document title. A preamble chunk's path is exactly that one
   element.

### `chunk_id`

```
section   {source}:{concept}:{heading-path-slug}
          azure:cqrs:solution--benefits-of-cqrs

child     {source}:{concept}:{heading-path-slug}:{sha8}
          azure:cqrs:solution--benefits-of-cqrs:a3f21b09
```

Path segments below the title are slugified and each truncated to 40 characters, joined with
`--`. Measured: 490 section ids, zero collisions, longest 99 characters. Truncation to 32 also
gives zero collisions, so 40 leaves margin. The current scheme needs 76 hash suffixes to
disambiguate; the new one needs none, because a heading path is already unique.

**Children are keyed on content, not position.** `specs/005` FR-005 required label-derived rather
than positional ids, and a paragraph-split child has no label to derive from. An ordinal would
survive an edit upstream while coming to denote different text — a stored citation would keep
pointing at it and quietly mean something else. A content hash breaks visibly instead. Each level
uses the most stable identifier it has: a heading for sections, its own text for sub-splits.

**Every existing `chunk_id` changes**, since the `kind` segment is gone. Nothing outside the
build references them yet, so this is acceptable exactly once, and must not happen again.

### Splitting

A section whose body exceeds **3,000 characters** splits. Boundaries are preferred in the order:
list items, then paragraphs. Fenced code blocks are masked before boundaries are chosen; a
section that cannot be split without cutting a fence stays whole and exceeds the cap, which the
spec permits. No child below **300 characters** is emitted — such a remainder merges into its
neighbour.

Measured section sizes across 490 sections: mean 1,559, p50 1,097, p90 3,409, p100 9,498. At a
3,000 cap, 65 sections (13.3%) split, giving roughly 146 children and about 571 chunks in total.

**Why 3,000 rather than 2,000.** A 2,000 cap forces 26.7% of sections through arbitrary paragraph
splitting, and an arbitrary split is worse than no split — it cuts through an argument. At 3,000
only the genuinely long sections are touched, and those are the ones most likely to cover several
points anyway.

**Why the cap exists at all**, recorded because a limit without a reason gets tuned away: an
embedding model returns one vector per input regardless of length, so a chunk spanning several
topics becomes a point near none of them. Explicitly *not* the model's token limit —
`text-embedding-3-small` accepts 8,191 tokens ≈ 32,000 characters against a largest section of
~9,500, so citing that would be checkable and false. The anti-dilution benefit is not realised in
this feature, since chunk vectors stay empty; the cap is fixed now because it is baked into
`chunk_id`, which is expensive to change later. What it does buy immediately is citation
granularity.

## Migration notes

- One migration, `corpus_structure_rebuild`.
- Dropping `kind` and `kindConfidence`, both `NOT NULL` with no default, requires the existing
  `doc_chunk` rows to go. The migration truncates the table. This is safe: every row is
  reproducible from the source layer, and every `chunk_id` changes regardless.
- `concept.aliases` is dropped after `concept_terms` is created and populated. All 49 rows have
  it empty, so nothing is carried over.
- `Concept` rows are preserved. `concept_id` is never renamed — hard constraint 2 — and the ~20
  new candidate rows are additions.
- The `vector` extension is already enabled (`previewFeatures = ["postgresqlExtensions"]`,
  `extensions = [vector]`). No pgvector index is created: at ~70 vectors a sequential scan is
  microseconds, and an index would cost write time and space for no gain. An index becomes worth
  considering somewhere around a million vectors.
