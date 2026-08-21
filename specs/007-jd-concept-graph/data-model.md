# Data Model: JD Concept Graph

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-21

One migration. `JdSubmission` is reshaped, `ExtractedItem` is new, `CandidateTrainingDirection`
is dropped. `Concept`, `ConceptTerm` and `DocChunk` are read but not altered.

## `JdSubmission` — reshaped

```diff
 model JdSubmission {
   id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
   rawText           String   @map("raw_text")
-  role              String?
-  techStack         String[] @map("tech_stack")
-  seniority         String?
-  seniorityInferred Boolean  @default(false) @map("seniority_inferred")
-  status            String
-  rejectionReason   String?  @map("rejection_reason")
   createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz
-  candidateTrainingDirections CandidateTrainingDirection[]
+  items             ExtractedItem[]
 }
```

Six columns go. Each described the old pipeline's output shape: `role`, `techStack` and
`seniority` were the extraction result, `status` and `rejectionReason` were the whole-submission
sufficiency gate that FR-004 replaces with per-item `unresolved`. Keeping `status` would invite
reinstating that gate, which FR-022 forbids.

`rawText` and `createdAt` survive and are the whole point of persisting at all: the text is
user-supplied and not reproducible, and the coverage benchmark and gap queue will need the
history to have started accumulating.

**Nothing in this feature reads a submission except the graph endpoint reading its own items**
(FR-026). The table is written far more than it is read, on purpose.

## `ExtractedItem` — new

One row per distinct technical phrase found in a submission, with its resolution outcome.

```prisma
enum ResolutionTier {
  exact
  similarity
  unresolved
}

model ExtractedItem {
  id             String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  submissionId   String         @map("submission_id") @db.Uuid
  surface        String
  normalized     String
  evidence       String[]
  conceptId      String?        @map("concept_id")
  tier           ResolutionTier
  score          Float?
  createdAt      DateTime       @default(now()) @map("created_at") @db.Timestamptz

  submission JdSubmission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  concept    Concept?     @relation(fields: [conceptId], references: [conceptId], onDelete: Restrict)

  @@unique([submissionId, normalized])
  @@index([submissionId])
  @@index([conceptId])
  @@map("extracted_items")
}
```

**Field notes**

- `surface` is the phrase as the posting wrote it; `normalized` is the same phrase through
  `normalizeTerm`, the single implementation shared with the corpus term index. Storing both
  means a resolution can be explained after the fact without recomputing.
- `evidence` is a list because FR-003 requires one item per phrase while retaining every place it
  occurred. A phrase mentioned three times is one row with three spans, not three rows.
- `@@unique([submissionId, normalized])` is what enforces FR-003 structurally rather than by a
  check in application code — the same reasoning that made `ConceptTerm.term` a primary key in
  SCRUM-44. Two mentions of the same phrase cannot become two rows.
- `conceptId` is nullable and `tier` is not. An unresolved item has `tier = unresolved` and a null
  concept; the state is never inferred from the null. FR-008 forbids a third state where an item
  quietly has neither.
- `score` is null for `exact` — there is no score, and writing 1.0 would suggest a measurement
  that did not happen. It is populated for `similarity` and, for `unresolved`, carries the best
  score seen so a near miss is distinguishable from nothing close (FR-008).
- `onDelete: Restrict` on the concept relation, matching `DocChunk`: a concept with items
  pointing at it must not be deletable out from under them.

### State

An item has exactly one of three outcomes and does not move between them after resolution:

```
exact        conceptId set, score null      tier-1 primary-key hit
similarity   conceptId set, score >= threshold
unresolved   conceptId null, score = best seen (or null if nothing was compared)
```

Re-submitting the same text creates a new submission with its own items rather than mutating
existing ones, so a stored result is a record of what the system said at that time.

## `CandidateTrainingDirection` — dropped

The model, its table, and the relation from `JdSubmission`. It has no successor: the old
pipeline's "training directions" do not exist in the current product shape, and nothing in this
feature or the point cloud reads them.

## Read but unchanged

- **`ConceptTerm`** — tier 1 is `SELECT concept_id FROM concept_terms WHERE term = $1`, one
  primary-key lookup. The `alias` term type stays reserved and unused.
- **`Concept`** — `embedding` drives tier 2 and the inferred edges; `related` supplies the
  authored edges; `hasCorpus` marks the 21 grey nodes.
- **`DocChunk`** — not read by this feature at all. `embedding` stays empty.

## Derived, not stored

**Relevance** is computed per request from a submission's items: a concept's relevance follows
from the items that resolved to it. Concepts nothing resolved to appear with zero relevance
rather than being omitted, because the client needs the whole map to show what was *not* matched
(FR-011, Assumptions).

**Inferred edges** are computed per request from the 70 concept vectors — 2,415 pairwise
comparisons, microseconds. Not materialised: a stored edge table would need invalidating whenever
a vector changes, and at this size there is nothing to gain.

**The threshold** is not a column. It is produced by a calibration run and recorded as a
committed artifact together with the baseline that produced it (FR-019b), so a threshold can
always be traced to the measurement behind it.

## Invariants the tests assert

1. One item per distinct normalized phrase per submission — enforced by the unique constraint,
   asserted by attempting a duplicate.
2. Every item has exactly one of the three outcomes; no item has `tier = unresolved` with a
   concept set, and none has a concept with `tier = unresolved`.
3. `exact` items never carry a score.
4. The graph for a submission is identical across repeated requests (FR-015).
5. Authored and inferred edges are distinguishable in the response, and their counts are
   reportable separately (FR-012).
6. Returned mean degree is near the target with no unconnected concept (FR-013), measured on the
   real 70-concept graph rather than a fixture.

## Migration notes

- One migration, `jd_concept_graph`.
- `candidate_training_directions` is dropped outright. `jd_submissions` loses six columns.
  Existing rows are development data from the removed pipeline; the migration does not attempt to
  carry them forward, and any that exist are left with only `rawText` and `createdAt` intact —
  which is exactly the surviving shape, so no truncation is required.
- `extracted_items` is created empty.
- No pgvector index. Tier 2 compares one query vector against 70 concept vectors, and inferred
  edges are 2,415 comparisons; both are microseconds, and an index would cost write time and
  space for nothing. The threshold for reconsidering is the same as recorded in SCRUM-44 —
  somewhere around a million vectors.
