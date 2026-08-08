# Feature Specification: Corpus Ingest Foundation — `concept`/`doc_chunk` Schema + Azure Chunking Pipeline

**Feature Branch**: `scrum-42-corpus-ingest-foundation`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "Corpus ingest foundation: add the concept and doc_chunk
tables and implement the azure chunking pipeline per docs/DESIGN.md §5 and §7.5. Scope is
deliberately limited to the azure source only (the one source confirmed to have a genuine
tradeoff template, §7.1). Deliverables: (1) Prisma schema for concept and doc_chunk per
§5's field lists, resolving open decision §13 #5; (2) a chunking tool under corpus/tools/
implementing §7.5's full spec - split on H2 and H3, never inside code fences, kind
classification by case-insensitive regex, item-level split on the bold-label bullet
pattern, concatenated contextual prefix, related-link extraction, directive-line cleanup;
(3) idempotent ingest into Postgres keyed on content_hash; (4) an unmapped-headings report
per §9 item 4; (5) a seed set of concept rows covering the azure patterns, drafted as
candidates for human accept/reject per §9 item 1. Hard constraints from §12 apply in full,
especially #1 (source text never rewritten) and #2 (concept_id never renamed once
admitted)."

## Background

This is **"Feature A"** of the two-feature sequencing plan agreed right after
`docs/DESIGN.md` was adopted as the project's design source of truth (see DESIGN.md §16
and the project's P0 priority list, §11). It is the first piece of the new pipeline to be
built, and it deliberately builds nothing else: no extraction, no resolve, no retrieval,
no question generation. Its entire job is to turn the azure corpus (already fetched and
filtered — see `corpus/_meta/manifest/azure.jsonl`, 58 files, CC-BY-4.0, `citable: true`)
into structured, verbatim-preserving rows in Postgres that a future retrieval step can
query, plus a first draft of the `concept` identity table those rows attach to.

**Why azure only**: DESIGN.md §7.1 found that of the sources probed, azure is the *only*
one with a genuinely decision-relevant fixed template (`Context and problem` / `Solution`
/ `Problems and considerations` / `When to use this pattern`) — every other "structured"
source that `structure-probe.md` flagged turned out to be a false positive (API-reference
boilerplate, not tradeoff content). Scoping this feature to one source is also a
deliberate defense against §11's named failure mode: "spending two weeks on
corpus-building without ever running the full pipeline end to end once."

**What this feature explicitly does NOT do** (see the project's P0 sequencing decision,
recorded 2026-08-08): it does not touch the existing `JdSubmission` /
`CandidateTrainingDirection` tables or the old extract/generate pipeline built under
SCRUM-38/39/41 — that pipeline is being replaced, not extended, but its removal is
"Feature B"'s job, done together with the new online pipeline so there's never a window
where neither exists. It does not implement `resolve`, `combine`, `retrieve`, `generate`,
or any of DESIGN.md §4.2's online pipeline steps. It does not compute concept embeddings
(that's `resolve`'s P1 vector-fallback concern, DESIGN.md §8) or fetch/chunk any source
other than azure.

This feature resolves DESIGN.md §13's open decision #5 (the unified `Item` data model's
fields) — that decision blocks the start of all other P0 work, which is why this feature
comes first.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn the azure corpus into queryable, verbatim source chunks (Priority: P1)

As the person operating the corpus pipeline, I run the chunking tool against the fetched
azure corpus and it produces `doc_chunk` rows in Postgres — one row per cost, benefit,
when-to-use, example, or meta item found in the source documents — each carrying the
source text **word-for-word**, correctly attributed to its pattern and kind, so that a
future retrieval step has real, citable material to query the moment it's built.

**Why this priority**: This is the entire point of the feature. Without accurate,
verbatim, correctly-classified chunks, nothing downstream (resolve, retrieve, generate,
verbatim verification) has anything real to work with — DESIGN.md's whole product
differentiator (every judgment traces to a verbatim excerpt) is grounded here.

**Independent Test**: Run the tool against `corpus/raw/azure/` and confirm: every
`doc_chunk.content` value is found byte-for-byte as a substring of its source file (no
model, no rewriting involved at all — this can be verified purely by string search);
`Benefits of CQRS`, which DESIGN.md's own investigation found buried at H3 under `##
Solution`, appears as its own `benefit`-kind chunk rather than being lost inside a
3,000-word `Solution` chunk.

**Acceptance Scenarios**:

1. **Given** an azure pattern page with H3 headings nested under an H2 (e.g. `##
   Solution` containing `### Separate read models and write models` and `### Benefits of
   CQRS`), **When** the chunking tool runs, **Then** the H2 section becomes a chunk
   containing only its intro text before the first H3, and each H3 becomes its own
   separate chunk — `Benefits of CQRS` is never merged into or lost inside the `Solution`
   chunk.
2. **Given** a section whose content includes a fenced code block containing lines that
   look like markdown headings (e.g. a YAML comment starting with `##`), **When** the
   chunking tool runs, **Then** no split occurs inside that code fence — the block stays
   intact inside whichever chunk contains it.
3. **Given** a `Problems and considerations` (or `Issues`, `Considerations`, `Challenges`,
   `Limitations`) heading, **When** kind classification runs, **Then** the resulting
   chunk(s) are classified `kind = cost`; given a `Benefits`-prefixed heading, or one
   containing the standalone word `Advantages` anywhere (e.g. "Pattern advantages"), `kind
   = benefit`; `When to use...`, `kind = when`; `Example` or `Next step`, `kind = example`;
   `Workload design`, `Related resources`, or `Contributors`, `kind = meta` — matching is
   case-insensitive regex, not an exact string match; every mapping is prefix-anchored
   except the `Advantages` case (FR-008).
3a. **Given** a heading (H2 or H3) whose nearest ancestor H2 is `Context and problem`,
    **When** kind classification runs, **Then** that heading is never assigned `cost`,
    `benefit`, or `when`, even if its own text would otherwise match one of those regexes —
    a `Context and problem` section states the problem the pattern *solves*, not a
    tradeoff of adopting it. Motivating case: `saga-content.md` has an H3 "Challenges in
    microservices architectures" nested under `## Context and problem`; its text matches
    the `cost` regex, but without this guard it would be stored as `kind = cost,
    pattern_id = saga` — retrieval would then surface it as "a cost of Saga," which is
    semantically wrong (it describes the difficulty Saga exists to address). A heading
    caught by this guard is classified normally against the remaining kinds
    (`example`/`meta`) and falls to `unmapped` otherwise, same as any other unrecognized
    heading.
4. **Given** a `cost`, `benefit`, or `when` section containing top-level bulleted items in
   one of the bold-label forms (`- **Label.** body`, `- **Label:** body`, `- **Label**.
   body`, `- **Label**: body`, or `- **Label** body`), **When** item-level chunking runs,
   **Then** each such bullet becomes its own standalone chunk with the label and body
   recorded separately, rather than the whole section staying as one chunk.
5. **Given** a bullet inside a `cost`/`benefit`/`when` section that does **not** match any
   of the bold-label forms above (the common case — 77.8% of real bullets in these
   sections carry no bold label at all), **When** item-level chunking runs, **Then** that
   bullet's text is retained as part of its parent section chunk — it is never silently
   dropped for failing to match an item pattern.
6. **Given** a section marked for discard (the `Workload design` section, which DESIGN.md
   identifies as Azure Well-Architected Framework cross-references rather than tradeoff
   content), **When** chunking runs, **Then** no chunk is produced from that section's
   body, though its heading is still recognized (`kind = meta`) rather than falling into
   the unmapped report.
7. **Given** a chunk's source text contains a Well-Architected directive line (e.g.
   `:::image type="content" source="...":::`), **When** cleanup runs, **Then** the
   directive line is stripped from `content` — the surrounding prose is otherwise
   untouched, character for character.
7a. **Given** a chunk's source text contains a markdown link (e.g. `cqrs.md`'s "Increased
    complexity" cost bullet, which links to `./event-sourcing.md`), **When** the chunk is
    stored, **Then** the full link markup — both the visible text and the target, e.g.
    `[Event Sourcing pattern](./event-sourcing.md)` — is retained byte-for-byte in
    `content`, unreduced to visible text alone; the link's target is *also* captured
    separately (a read-only scan, not a mutation) as a candidate related-pattern signal
    for concept-candidate generation.
8. **Given** a chunk that, taken alone, doesn't mention the pattern name it belongs to
   (e.g. a cost bullet that just says "the read data might not show the most recent
   changes"), **When** the chunk is stored, **Then** a contextual prefix (e.g. `[CQRS
   pattern / Problems and considerations]`) is computed and stored in a field separate from
   `content` — `content` itself holds only the verbatim source substring, never the prefix,
   so that a verbatim-verification check against `content` can never be satisfied by
   prefix text the pipeline synthesized rather than text the source document actually
   contains.
9. **Given** the ingest tool is run twice in a row against an unchanged azure corpus,
   **When** the second run completes, **Then** zero rows are added, removed, or modified —
   the run is a true no-op.
10. **Given** a single azure source file changes between two ingest runs (its content
    hash differs), **When** the second run completes, **Then** only that file's chunks are
    replaced — chunks sourced from every other unchanged file are untouched, and no
    existing `chunk_id` is reused to hold different content than it originally held.
11. **Given** a new item-level bullet is inserted above an existing one within the same
    section (e.g. a new `cost` bullet added before an existing `- **Eventual
    consistency.**...` bullet), **When** the file is re-chunked, **Then** the existing
    bullet's `chunk_id` is unchanged — chunk identity is derived from the item's label, not
    its position among its siblings, so reordering or insertion elsewhere in the section
    never repurposes an existing `chunk_id` to hold different content (FR-005).

---

### User Story 2 - Catch classification gaps before they silently poison a question (Priority: P2)

As the person reviewing corpus quality, after an ingest run I can see a report of every
heading in the azure corpus that didn't match any `kind` classification rule, ranked by
how often it occurred, so I can decide whether to extend the regex, treat it as a mixed
section, or leave it alone — instead of a benefit silently landing in the corpus
unclassified (or worse, misclassified) and only surfacing months later as a wrong citation
in a generated question.

**Why this priority**: DESIGN.md §9④ calls this "the most insidious case" of gap —
unlike a missing concept or missing material, a classification miss doesn't throw an
error, doesn't show up in any "here's what's missing" list, and silently corrupts output.
It's P2 rather than P1 only because User Story 1 has to exist first for there to be
anything to classify.

**Independent Test**: Point the tool at a corpus (or a fixture) containing a heading like
`## Related patterns` that doesn't match `cost`/`benefit`/`when`/`example`/`meta`, run
ingest, and confirm that heading (with its occurrence count) appears in the unmapped
report — and confirm a heading that *does* match a `kind` rule does **not** appear in the
report.

**Acceptance Scenarios**:

1. **Given** a heading that does not match any configured `kind` regex, **When** ingest
   runs, **Then** that heading's text and occurrence count across the corpus appear in the
   unmapped-headings report, and the section is still stored (unclassified — `kind =
   null` or an explicit `unmapped` marker) rather than being silently dropped or forced
   into an incorrect kind.
2. **Given** two different unmapped headings that occur with different frequencies across
   the corpus, **When** the report is generated, **Then** they are ranked so the more
   frequent (higher-impact) gap is easier to notice first.
3. **Given** a full ingest run where every heading in the corpus matched a `kind` rule,
   **When** the report is generated, **Then** it clearly indicates zero unmapped headings
   rather than being empty/absent in a way that could be mistaken for "not run."

---

### User Story 3 - Review draft concept candidates for the azure patterns (Priority: P2)

As the person responsible for corpus admission, after an ingest run I can see one draft
`concept` candidate per azure pattern (id, display name, kind, proposed aliases, proposed
related patterns) and, for each, accept it as-is, reject it, or edit it before accepting —
never typing one in from scratch — so that every azure pattern becomes a recognizable
concept the moment I approve it, without needing to hand-author 50+ concept rows one at a
time.

**Why this priority**: DESIGN.md §9①'s explicit design goal is that "the human is only in
the admission slot, and it's always accept/reject, never data entry." This user story is
what makes that true for the azure batch specifically. It's P2, not P1, because
`doc_chunk` (User Story 1) has standalone value even with zero admitted concepts — but a
`concept` row is what turns "I have material" into "the system can recognize a JD mention
of this pattern," so it's needed before the corpus is genuinely useful.

**Independent Test**: Run the candidate-generation step against the azure corpus and
confirm exactly one candidate exists per concept-eligible azure file (49 — see SC-005 for
the exact inclusion/exclusion rule; not all 58 manifest entries are concepts), each with a
non-empty proposed `kind` and a `concept_id` derived per the normalization rule below —
and confirm that none of these candidates are usable by (a hypothetical future) `resolve`
until explicitly accepted.

**Acceptance Scenarios**:

1. **Given** the azure corpus has been chunked, **When** candidate generation runs,
   **Then** exactly one concept candidate is produced per concept-eligible pattern file
   (SC-005's 49), with `concept_id` derived from the source filename by taking the
   filename stem and stripping a trailing `-content` or `-pattern` segment if present
   (azure's own naming convention is otherwise already lowercase-hyphenated) — each
   candidate also gets a proposed `kind`, and, where inferable from the chunked
   related-link data, a proposed `related` list.
1a. **Given** the source file `retry-content.md`, **When** its concept candidate is
    generated, **Then** the resulting `concept_id` is `retry`, not `retry-content` — and
    equivalently for every other one of the 18 `-content`-suffixed and 1 `-pattern`-suffixed
    files in the corpus (e.g. `saga-content.md` → `saga`, `rate-limiting-pattern.md` →
    `rate-limiting`). This is a blocking rule: DESIGN.md §12 #2 makes `concept_id`
    permanent once admitted, so an unstripped suffix reaching admission is not correctable
    without deprecating and re-adding the concept, severing every `doc_chunk.pattern_id`
    foreign key already pointing at it.
2. **Given** a generated candidate, **When** it is inspected before any human action,
   **Then** it is not usable as a real concept anywhere else in the system (it does not
   count toward `has_corpus` coverage reporting or anything an operator would treat as
   "live") — admission is a distinct, later action.
3. **Given** a human reviews a candidate and accepts it, **When** admission completes,
   **Then** a live `concept` row exists with that `concept_id`, and — per the hard
   constraint in DESIGN.md §12 #2 — that `concept_id` is now permanent: it may never be
   renamed, only superseded by a new id with the old one marked `deprecated`.
4. **Given** a human rejects a candidate, **When** the decision is recorded, **Then** the
   candidate is marked rejected (not silently deleted) so the decision and its reasoning
   are auditable later, and it is not re-proposed on a subsequent candidate-generation
   run for the same pattern.

---

### Edge Cases

- An azure pattern file with **no** section matching any `kind` regex at all (a purely
  narrative page, if one exists) still produces a candidate concept (User Story 3) even
  though it contributes zero classified `doc_chunk` rows beyond `meta` — `has_corpus`
  reflects "material exists" honestly per pattern, not per corpus.
- A pattern page whose H2 (`## Combine the Event Sourcing and CQRS patterns`) discusses a
  *different* pattern than the one the file itself represents — chunking attributes those
  chunks to the file's own pattern (the file is the pattern-identity boundary), and any
  reference to the other pattern is captured only as a related-link candidate, never as a
  second `pattern_id` for those chunks.
- Re-running candidate generation after some candidates have already been admitted or
  rejected must not re-propose or duplicate those — only patterns with no prior decision
  get a (re-)generated candidate.
- A chunk whose entire body, after directive-line cleanup, would be empty (e.g. a section
  that was *only* a `:::image:::` directive) is not stored as a hollow chunk.
- The 6 architecture-style pages included in this feature's scope (see SC-005) use
  `## Benefits` / `## Challenges` headings — these match the `benefit`/`cost` regexes
  (FR-008) and produce genuine chunks — but have no `## When to use...`-style section at
  all. The resulting concept legitimately ends up with `benefit` and `cost` material but no
  `when` chunk. This is the expected §9③ "a specific kind is missing" degraded case, not a
  chunking defect, and MUST NOT be treated as a bug or surfaced as an unmapped heading —
  there is no missing/misclassified heading here, the source document simply doesn't have
  that section.

## Requirements *(mandatory)*

### Functional Requirements

**Schema**

- **FR-001**: The system MUST define a `concept` table with, at minimum: a stable,
  human-readable, lowercase-hyphenated identifier derived from the pattern's name per the
  normalization rule in FR-023 (e.g. `cqrs`, `retry` — not a raw, unnormalized filename); a
  display name; a list of alias strings; a `kind` classification (`language | framework |
  platform | architecture | practice | tool | domain`); a list of related concept
  identifiers; a `has_corpus` boolean; a nullable embedding vector; a lifecycle `status`;
  and a provenance field recording how the row originated (e.g. `seed`).
- **FR-002**: The `concept` table's lifecycle `status` MUST distinguish at least four
  states: a proposed-but-not-yet-reviewed candidate, an admitted/live concept, a
  deprecated concept (superseded by a newer id), and a rejected candidate — so that
  candidate rows (User Story 3) are structurally incapable of being mistaken for admitted
  ones by any downstream consumer that filters on status.
- **FR-003**: The system MUST define a `doc_chunk` table with, at minimum: a stable chunk
  identifier; a foreign key to the `concept` (pattern) it belongs to; a `kind`
  classification; a short label; the verbatim source content (and, in a field separate
  from that content, the computed contextual prefix — FR-013); the source URL; a `citable`
  flag; a `kind_confidence` field (`regex | llm | manual`); and a document-freshness date
  captured from the source file's frontmatter where present.
- **FR-004**: A `concept_id`, once admitted (status moves out of "candidate"), MUST NOT
  ever be renamed by any tool in this feature or reused for a different concept — the only
  permitted change is superseding it with a new id while marking the old one deprecated
  (DESIGN.md §12 #2, non-negotiable).
- **FR-005**: A `doc_chunk.chunk_id`, once written, MUST remain stable for the same
  source content across repeated ingest runs, and MUST NOT be reused to hold different
  content than it originally held.

**Chunking**

- **FR-006**: The chunking tool MUST split each of the 49 concept-eligible azure source
  documents (the same file set defined in FR-023/SC-005 — repo-meta files, index pages, and
  the two multi-concept comparison guides are out of scope for chunking, not just for
  candidate generation) on both `##` (H2) and `###` (H3) headings — H2-only splitting is
  insufficient: `cqrs.md`'s "Benefits of CQRS" and two other tradeoff-relevant headings
  live at H3 nested under a shared H2 and would otherwise be buried inside a much larger H2
  chunk (see SC-004). Corpus-wide, H3 tradeoff headings turn out to be a small minority (3
  of 9 `benefit` headings, 5 of 106 tradeoff-kind headings total — research.md §6) rather
  than "most benefit content," correcting an overstated claim in an earlier draft of this
  rule; the requirement itself is unchanged, since even a small, real loss of tradeoff
  content is worth preventing.
  - **FR-006a**: Where an H2 has one or more H3 children, the H2's own chunk MUST contain
    only the text preceding its first H3 child — H3 content MUST NOT be merged into the
    parent H2 chunk.
- **FR-007**: The chunking tool MUST NOT split inside fenced code blocks (``` ```), even
  if the fenced content contains lines that look like heading syntax.
- **FR-008**: The chunking tool MUST classify each resulting section's `kind` via
  case-insensitive regex matching against the section's heading text, using at minimum
  these mappings: `cost` for headings starting with `Problems`, `Issues`,
  `Considerations`, `Challenges`, or `Limitations`; `benefit` for headings starting with
  `Benefits`, **or containing the standalone word `Advantages` anywhere in the heading**
  (not prefix-anchored — see below); `when` for headings starting with `When to use`;
  `example` for headings starting with `Example` or `Next step`; `meta` for `Workload
  design`, `Related resources`, or `Contributors` (all of these remain prefix-anchored).
  (`Advantages` is a deviation from DESIGN.md §7.5's literal regex list, added because the
  corpus contains two unmapped benefit-meaning headings — "Pattern advantages" and
  "Advantages and considerations for each strategy" — that the `Benefits`-only regex would
  otherwise miss; see research.md §6. An earlier draft of this requirement described
  `Advantages` as prefix-anchored like the rest, which is wrong — "Pattern advantages" has
  the word as its *second* word, not a prefix; caught during implementation because a test
  written directly from this requirement's own motivating example failed against a
  prefix-only match.)
  - **FR-008a**: This classification MUST NOT assign `cost`, `benefit`, or `when` to any
    heading (H2 or H3) whose nearest ancestor H2 is `Context and problem`, regardless of
    whether the heading's own text matches one of the regexes above — see acceptance
    scenario 3a for the motivating case (`saga-content.md`) and rationale.
- **FR-009**: Within a section classified `cost`, `benefit`, or `when`, the chunking tool
  MUST further split top-level bullets matching any of these bold-label forms into
  standalone item-level chunks, recording the label and body separately: `- **Label.**
  body` (period inside the bold — DESIGN.md §7.5's originally specified form), `-
  **Label:** body` (colon inside the bold), `- **Label**. body` or `- **Label**: body`
  (punctuation immediately after the bold, outside it), or `- **Label** body` (bold
  followed directly by body text with no punctuation at all). Bullets that do not match any
  of these forms MUST remain part of their parent section's chunk rather than being
  dropped. (Measured across the real corpus — research.md §6 — DESIGN.md §7.5's claim that
  the period-inside-bold form alone is "highly consistent across the azure corpus" does not
  hold outside `cqrs.md`, where it was evidently generalized from: only 5.6% of the 684
  top-level bullets in `cost`/`benefit`/`when` sections use that exact form corpus-wide, and
  77.8% carry no bold label at all. Covering all five forms above raises item-level
  splitting coverage to 22.2% — still a minority, and correctly so: most bullets are plain
  prose with no label to extract.)
- **FR-010**: The chunking tool MUST discard the body content of any section classified
  under the `Workload design` heading (Azure Well-Architected Framework cross-references,
  not tradeoff content) without producing a chunk for it, while still recognizing the
  heading itself as classified (not unmapped).
- **FR-011**: The chunking tool MUST strip directive lines (e.g. `:::image:::`,
  `:::code:::` and similar `:::...:::` syntax) from stored chunk content.
- **FR-012**: The chunking tool MUST retain markdown link markup — both the visible text
  and the target, e.g. `[Event Sourcing pattern](./event-sourcing.md)` — byte-for-byte
  exactly as it appears in the source within chunk `content`; it MUST NOT reduce a link to
  its visible text alone (an earlier draft of this requirement said "preserve visible
  text," which would have stripped the markup and directly contradicted SC-001's
  zero-exception verbatim-substring guarantee — 41 of 106, 38.7%, of the real corpus's
  `cost`/`benefit`/`when` section chunks contain at least one markdown link, so this is not
  an edge case). Separately, and without altering `content`, the chunking tool MUST scan
  chunk content for link targets and capture them as a candidate related-pattern signal
  (feeding concept-candidate generation, User Story 3) — this extraction is a read-only
  scan producing a separate value, not a transformation of stored content.
- **FR-013**: The chunking tool MUST compute a contextual prefix for each chunk and store
  it in a field **separate from** `content` — `content` MUST hold only the verbatim source
  substring, with the prefix concatenated only at prompt-assembly time by a future
  consumer, never at storage time. This keeps `content` — the field a future
  verbatim-verification check (`content.includes(verbatim)`, DESIGN.md §4.2 ⑥) is checked
  against — free of any text this pipeline synthesized, so that check can never be
  satisfied by prefix text rather than genuine source text (a silent sourcing failure of
  exactly the class DESIGN.md §12 #1 and #3 exist to prevent).
  - **FR-013a**: For a section-level (H2) chunk, the prefix format is `[<Pattern name>
    pattern / <H2 heading>]` (e.g. `[CQRS pattern / Problems and considerations]`). For an
    H3 chunk, the prefix MUST include the **full ancestor chain**, not just the H3's own
    heading: `[<Pattern name> pattern / <H2 heading> / <H3 heading>]` (e.g. `[CQRS pattern
    / Combine the Event Sourcing and CQRS patterns / Considerations for how to combine the
    Event Sourcing and CQRS patterns]`) — an H3 heading alone can be uninterpretable in
    isolation without knowing which H2 section it's nested under. **Rationale, recorded
    because it differs from DESIGN.md's own stated one**: §7.5 justifies the contextual
    prefix by retrieval recall ("a chunk that doesn't contain the word CQRS can still be
    matched"), but §8 fixes `retrieve` as an exact `pattern_id` table lookup with no vector
    search — that retrieval-recall justification does not apply to this pipeline as
    designed. The prefix's only live use is as context handed to a future `generate` step
    at prompt-assembly time, and for that use, the ancestor chain — not just the
    immediate heading — is what makes an otherwise-ambiguous H3 chunk interpretable on its
    own.
- **FR-014**: Under no circumstance may any step in the chunking or ingest pipeline
  paraphrase, summarize, clean up, or otherwise alter the meaning-bearing wording of
  source text (DESIGN.md §12 #1, non-negotiable, no exceptions). FR-011's directive-line
  stripping is the only permitted transformation of `content`. FR-012's link-target
  extraction MUST NOT be read as a second permitted transformation — it is a read-only
  scan over `content` that produces a separate value (a related-pattern candidate); it MUST
  NOT remove, reduce, or otherwise alter any link (or anything else) within `content`
  itself.
- **FR-015**: Where a source file's frontmatter includes a document date (e.g. `ms.date`),
  the chunking tool MUST capture it on the resulting chunk(s) for later freshness
  judgments.

**Ingest**

- **FR-016**: Ingest MUST be idempotent: running it twice against unchanged source files
  MUST NOT create duplicate rows, MUST NOT alter existing rows, and MUST be detectable as
  a no-op via a per-file content hash.
- **FR-017**: When a previously-ingested source file's content hash changes, ingest MUST
  replace exactly that file's chunks (and only that file's) — chunks from every other
  unchanged file MUST be left untouched.
- **FR-018**: Every ingested `doc_chunk`'s `citable` flag MUST be set from the source's
  license tier (per the existing corpus manifest — azure is CC-BY-4.0, `citable: true`),
  not judged by hand per chunk.
- **FR-019**: Every ingested `doc_chunk`'s `kind_confidence` MUST be recorded as `regex`
  for this feature's azure-only, rule-based classification (no LLM is used to classify
  chunk boundaries or kind in this feature).

**Unmapped-headings report**

- **FR-020**: After an ingest run, the system MUST produce a report listing every distinct
  heading encountered that did not match any configured `kind` regex, together with its
  occurrence count across the corpus, ranked by frequency.
- **FR-021**: A heading that matched a `kind` regex MUST NOT appear in the unmapped
  report, including headings that matched but were then discarded by rule (e.g. `Workload
  design`, FR-010) — "discarded by rule" and "unmapped" are different, both-tracked
  states, not the same bucket.
- **FR-022**: The report MUST be produced (even if empty of findings) on every ingest run,
  so its absence is never mistaken for "nothing to report."

**Concept candidates**

- **FR-023**: The system MUST generate exactly one draft `concept` candidate per
  concept-eligible azure file — the 43 `docs/patterns/*.md` files (excluding `index.md`)
  plus the 6 `docs/guide/architecture-styles/*.md` files (excluding `index.md`): 49 total.
  It MUST NOT generate a candidate for repo-meta files (`README.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, `docs/changelog.md`), index pages (`docs/patterns/index.md`,
  `docs/guide/index.md`, `docs/guide/architecture-styles/index.md`), or the two
  multi-concept comparison guides (`docs/guide/choose-azure-container-service.md`,
  `docs/guide/container-service-general-considerations.md` — excluded because they compare
  several concepts in one file, breaking this spec's file-to-pattern 1:1 assumption; see
  Assumptions). Each candidate's `concept_id` MUST be derived by taking the source
  filename's stem and stripping a trailing `-content` or `-pattern` segment if present
  (e.g. `retry-content.md` → `retry`, `rate-limiting-pattern.md` → `rate-limiting`) — never
  the raw, unstripped filename stem. Each candidate also gets a proposed `kind`, and, where
  link data extracted during chunking (FR-012) suggests it, a proposed `related` list.
- **FR-024**: A candidate row MUST be structurally distinguishable (via `status`, FR-002)
  from an admitted concept, and MUST NOT be treated as a resolvable concept by any
  hypothetical downstream consumer until a human admits it.
- **FR-025**: Admitting or rejecting a candidate MUST be an explicit, low-effort human
  action (not free-text data entry) that updates the row's `status` — the system MUST NOT
  auto-admit any candidate under any condition (DESIGN.md §12 #7, non-negotiable).
- **FR-026**: Re-running candidate generation MUST NOT re-propose or duplicate a candidate
  for a pattern that already has an admitted, deprecated, or rejected concept row.

### Key Entities *(include if feature involves data)*

- **`concept`**: A pattern/technology's identity card — independent of whether source
  material exists for it yet. Key attributes: `concept_id` (stable, permanent once
  admitted), `name`, `aliases[]`, `kind`, `related[]` (other `concept_id`s), `has_corpus`,
  `embedding` (nullable — computed later, outside this feature's scope), `status`
  (candidate/active/deprecated/rejected), `added_from` (provenance, e.g. `seed`). One row
  per concept; for this feature, populated only by the azure-pattern candidate-generation
  step (User Story 3), starting in candidate status.
- **`doc_chunk`**: One row per piece of verbatim source text. Key attributes: `chunk_id`
  (stable, derived from pattern + kind + a slug of the item/section label — e.g.
  `azure:cqrs:cost:eventual-consistency` — not a positional index, so it survives edits
  elsewhere in the file, see data-model.md), `pattern_id` (foreign key to
  `concept.concept_id`), `kind` (`cost`/`benefit`/`when`/`example`/`meta`/`unmapped`),
  `label`, `content` (verbatim source text **only** — no prefix), `context_prefix` (the
  concatenated-at-prompt-time prefix, stored separately from `content` per FR-013),
  `source_url`, `citable`, `kind_confidence`, `doc_date`. Many rows per concept; populated
  entirely by the chunking pipeline (User Story 1) for this feature's azure-only scope.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every `doc_chunk` row produced from the azure corpus, the `content`
  field (which holds only verbatim source text, never the contextual prefix — FR-013) is
  verifiable as an exact, byte-for-byte substring of its named source file — checkable by
  simple string search, with zero exceptions and no carve-out needed.
- **SC-002**: Running ingest a second time against an unchanged azure corpus results in
  zero added, removed, or modified rows in either table.
- **SC-003**: Every H2 and H3 heading across the 49 concept-eligible azure files (SC-005)
  is accounted for in exactly one of: a classified `doc_chunk` (kind ∈
  cost/benefit/when/example/meta), a rule-based discard (e.g. `Workload design`), or the
  unmapped-headings report — none are silently absent from all three. The 9 excluded files
  (repo meta, index pages, the two multi-concept comparison guides) are out of scope for
  chunking entirely, not just for candidate generation — a `doc_chunk` row requires a
  `concept_id` to attach to via foreign key, and only the 49 concept-eligible files get
  one.
- **SC-004**: At least one `benefit`-kind chunk is produced from content that
  `structure-probe.md`'s original H2-only heading count would have missed entirely (e.g.
  `Benefits of CQRS`, observed nested at H3) — directly confirming the H2+H3 requirement
  closes the gap DESIGN.md §7.5 identified.
- **SC-005**: Exactly **49** concept candidates exist — one per concept-eligible azure
  file, **not** the full 58-file manifest count. The 49 = 43 files under
  `docs/patterns/` (all `.md` files there except `index.md`) + 6 files under
  `docs/guide/architecture-styles/` (all `.md` files there except `index.md`). The
  remaining 9 manifest files are explicitly excluded and MUST NOT produce a candidate:
  `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/changelog.md` (repo/doc meta, not
  concepts); `docs/patterns/index.md`, `docs/guide/index.md`,
  `docs/guide/architecture-styles/index.md` (index pages, not concepts);
  `docs/guide/choose-azure-container-service.md`,
  `docs/guide/container-service-general-considerations.md` (multi-concept comparison
  guides, excluded because they'd violate this spec's file-to-pattern 1:1 assumption).
  Each of the 49 candidates is reviewable and admittable/rejectable without hand-typing any
  field from scratch.
- **SC-006**: Zero concept candidates are resolvable as live concepts prior to explicit
  human admission — verifiable by inspecting candidate rows' status immediately after
  generation, before any human action has occurred.

## Assumptions

- **Non-goal: no stored `parent`/`section_path`/`level` column on `doc_chunk`.** FR-008a's
  parent-guard check (is this heading nested under `Context and problem`?) is needed only
  transiently, at classification time, while the chunker is walking the document tree — it
  does not need to be persisted as its own field afterward. FR-013a's ancestor chain is
  needed only as text inside the already-computed `context_prefix` string value, from
  which a section path could be recovered later (by splitting on ` / `) if some future
  feature ever needs it structured. Adding a dedicated column now, before any concrete use
  case needs to query or filter on it, would be exactly the kind of speculative
  pre-building DESIGN.md §15 question 5 warns against — the grouping/filtering use cases
  that might want a structured section path are hypothetical (§8), not triggered.
- **Concept candidate status model**: DESIGN.md §5 lists `concept.status` as `active |
  deprecated | rejected` but §9①'s described workflow (candidates exist, then a human
  admits or rejects them) requires a fourth, pre-admission state. This spec resolves that
  gap by adding a `candidate` status (FR-002) rather than storing candidates outside the
  `concept` table entirely — keeping one source of truth is simpler than reconciling a
  separate candidates file/table later, and a status filter is sufficient to keep
  candidates invisible to anything that should only see live concepts.
- **Embedding computation is out of scope for this feature.** `concept.embedding` exists
  as a column (schema completeness, since it's part of §5's field list) but is left null
  by every tool this feature builds; populating it is `resolve`'s concern (DESIGN.md §8,
  explicitly P1) and belongs to Feature B or a later pass, not corpus ingest.
- **Concept candidate generation may use an LLM to draft descriptive fields** (aliases,
  a short description) if useful, but this is an implementation choice for `plan.md`, not
  a spec requirement — the only thing this spec mandates is that whatever generates
  candidates never writes to `doc_chunk.content`-style source text and never sets a
  candidate's status to admitted on its own (FR-025 governs this regardless of how
  candidates are drafted).
- **`related[]` is not a `doc_chunk` column.** DESIGN.md §5's example `doc_chunk` fields
  don't include one, and §7.5's "extract link targets into `related[]`" reads naturally as
  feeding the *concept* graph, not chunk storage — this spec treats related-link
  extraction as an input to concept-candidate generation (FR-012, FR-023), not a stored
  chunk attribute.
- **File-to-pattern attribution is 1:1.** Each azure source file corresponds to exactly
  one pattern/concept, even when its content discusses combining with another pattern (see
  Edge Cases) — chunks are never attributed to more than one `pattern_id`. This is exactly
  why `docs/guide/choose-azure-container-service.md` and
  `docs/guide/container-service-general-considerations.md` are excluded from this
  feature's scope entirely (FR-023, SC-005/SC-003) rather than force-attributed to one of
  the several services they compare — they'd violate this assumption, not satisfy it.
- **The contextual prefix (FR-013) is computed and stored by this feature, but its
  concatenation onto `content` for an actual LLM prompt is a future consumer's job** (the
  `generate` step, DESIGN.md §4.2 ⑤, not built by this feature). Storing `content` and
  `context_prefix` as separate fields rather than pre-concatenating is what keeps a future
  verbatim check (`content.includes(verbatim)`) honest — it can never be satisfied by
  prefix text this pipeline synthesized.
- **`content_hash` is computed per source file**, reusing the `sha256` values already
  present in `corpus/_meta/manifest/azure.jsonl` from the corpus-build feature, rather than
  being recomputed independently — avoiding a second, potentially inconsistent hash of the
  same bytes.
- **This feature does not modify `JdSubmission` or `CandidateTrainingDirection`.** Those
  tables and their pipeline are removed in "Feature B," not here (see Background) — the
  new `concept`/`doc_chunk` tables are added alongside them without collision.
- **No other corpus source is touched.** Chunking/classification rules for prose sources
  (fowler, sre, aws-wa — DESIGN.md §7.7) and for the git sources DESIGN.md §7.3 flagged for
  cutting are explicitly out of scope; this feature's tooling is built to run against
  azure and is not required to generalize to other sources yet.
