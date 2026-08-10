# Feature Specification: Corpus Structure Rebuild

**Feature Branch**: `006-corpus-structure-rebuild`

**Created**: 2026-08-10

**Status**: Draft

**Input**: User description: "Corpus layer rebuild: structure-first chunking and the concept term table. Rebuild the offline corpus layer so it stores every section of every admitted document, replaces the abolished `kind` classification with structural metadata, and adds the concept-level vectors and term lookup the concept point cloud needs. No HTTP surface, no UI, no manual annotation step."

## Context

`docs/DECISIONS.md` (the fifteen `2026-08-10` entries) settles every design question in this
feature and is authoritative. `docs/DESIGN.md` carries the longer reasoning but five of its
sections are marked `[SUPERSEDED 2026-08-10]` — §7.5, §9③, §9④, §11's P0 list, §13 — and must
not be followed.

Two defects were measured against the real corpus and motivate this work:

| Defect | Measured |
|---|---|
| Heading-based `kind` filter discarded material, then reported it missing | 529,808 of 765,276 body characters dropped (69%) |
| Text before a document's first `##` never entered the chunker | 49 of 49 files, 29,251 characters, absent from the loss report too |

Both would have been caught by a single assertion that byte coverage is total. That assertion
is the centre of this feature's acceptance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No admitted source text is silently lost (Priority: P1)

Someone adds a document to the corpus and needs confidence that everything in it is now
retrievable. Today they cannot get that confidence: the pipeline reports which *headings* it
skipped, which says nothing about text under headings it did not recognise, and nothing at all
about text with no heading. After this change every byte of an admitted document is claimed by
exactly one stored unit, and that claim is checkable by machine rather than by inspection.

**Why this priority**: it is the guarantee the other two stories depend on — terms and vectors
built over an incomplete corpus would be confidently wrong. It is also the only story that
directly closes the two measured defects.

**Independent Test**: run the chunker over the admitted corpus and compare the total bytes
claimed by stored units against the total bytes of post-frontmatter source. Delivers a corpus
whose completeness is a number, not an assurance.

**Acceptance Scenarios**:

1. **Given** an admitted document with text before its first sub-heading, **When** the corpus is
   built, **Then** that text is stored as a unit identified by the document title alone.
2. **Given** an admitted document containing sections whose headings match no previously
   recognised category, **When** the corpus is built, **Then** those sections are stored on the
   same terms as any other section.
3. **Given** the full admitted corpus, **When** coverage is computed, **Then** the bytes claimed
   equal the bytes of post-frontmatter source exactly, with no unclaimed and no double-claimed
   remainder.
4. **Given** a section longer than the size limit, **When** it is split, **Then** the resulting
   parts together claim exactly the span the section claimed, with no gap and no overlap.
5. **Given** the corpus is built twice from unchanged sources, **When** the two outputs are
   compared, **Then** every identifier and every span is identical.

---

### User Story 2 - A concept can be found by the words people actually use (Priority: P2)

A job description refers to a concept using wording the source documentation does not use —
"Throttling pattern" where the record says `throttling`, or a title-cased form, or a
hyphenation variant. The system needs a single, unambiguous way to go from a phrase to a
concept, and needs it to be impossible for one phrase to claim two concepts.

**Why this priority**: it is the entry point every downstream consumer goes through, and it
requires no vectors, so it can be built and verified before any external service is involved.

**Independent Test**: build the term index from the concept records and assert that every
phrase maps to exactly one concept. Delivers deterministic lookup for the vocabulary the corpus
already contains.

**Acceptance Scenarios**:

1. **Given** a concept with an identifier, a display name and a document title, **When** the
   term index is built, **Then** each distinct normalised form of those becomes a lookup entry
   for that concept.
2. **Given** two concepts whose entries would produce the same normalised phrase, **When** the
   index is built, **Then** the build fails and reports every such conflict, not only the first.
3. **Given** one concept whose own entries produce the same normalised phrase more than once,
   **When** the index is built, **Then** the duplicate is dropped without error and the entry
   records the highest-precedence origin.
4. **Given** concepts referenced by existing relationship edges but never admitted with
   material, **When** the corpus is built, **Then** they exist as records marked as having no
   material, so they are distinguishable from concepts that were never heard of.

---

### User Story 3 - Concepts can be compared to each other and to unseen wording (Priority: P3)

A phrase arrives that the term index does not contain, or two concepts need to be placed
relative to one another. The system needs a similarity measure over concepts, and — before
anyone relies on it — evidence about whether that measure actually separates this concept set.

**Why this priority**: it depends on both stories above (the definition text comes from the
preamble units, the input text includes the terms), and it is the only part that calls an
external service. It also produces the calibration evidence a later similarity threshold
depends on.

**Independent Test**: compute a vector for every concept and report the distribution of
similarity for pairs that should match against pairs that should not. Delivers both the vectors
and the evidence for whether they are good enough.

**Acceptance Scenarios**:

1. **Given** a concept with material, **When** its vector is computed, **Then** the input text
   combines its display name, its lookup terms and the opening of its definition.
2. **Given** a concept without material, **When** its vector is computed, **Then** it is
   computed from the name and terms alone and the record remains marked as having no material.
3. **Given** all concept vectors, **When** calibration runs, **Then** it reports the similarity
   distribution for a positive baseline and a negative baseline, so that the separation between
   them can be judged before any threshold is chosen.
4. **Given** the combined text used as vector input, **When** the corpus is inspected, **Then**
   that combined text is not stored as a field anywhere.
5. **Given** the build needs a vector, **When** it obtains one, **Then** the request goes to the
   inference service over the existing interface and the provider credential never leaves that
   service.
6. **Given** two stored vectors need comparing, **When** the comparison runs, **Then** it runs
   on the persistence side as a database operation, not by sending vectors to the inference
   service.

---

### Edge Cases

- A document whose entire body precedes its first sub-heading — the preamble unit is the only
  unit, and coverage must still be total.
- A section consisting only of a fenced code block longer than the size limit — splitting must
  not cut inside the fence, so the unit exceeds the limit; this is correct behaviour and the
  limit is a target, not an invariant.
- A split that would leave a final part below the minimum useful size — it is merged into its
  neighbour rather than emitted, so no part is smaller than the minimum unless the whole section
  is.
- Two sections in the same document with identical heading paths — identifiers must remain
  distinct. Measured over the current corpus this does not occur (490 distinct, zero
  collisions), but the build must not silently overwrite if it ever does.
- A concept record naming a source file that is not present — the build must fail with the
  concept named, rather than skip it and produce a smaller corpus that looks complete.
- Sources are re-fetched rather than read from a committed copy; if the pinned upstream commit
  is unavailable the build cannot proceed and must say so.

## Requirements *(mandatory)*

### Functional Requirements

**Completeness and structure**

- **FR-001**: The corpus build MUST store every section of every admitted document. No section
  may be excluded on the basis of what its heading is called.
- **FR-002**: The corpus build MUST store text appearing before a document's first sub-heading
  as a unit whose heading path is the document title alone.
- **FR-003**: Every stored unit MUST record the heading path from the document title down to
  that unit, as an ordered sequence.
- **FR-004**: Every stored unit MUST record the byte offset and length of its span within the
  post-frontmatter source text, such that the span reproduces the unit's text exactly.
- **FR-005**: The spans of all units from one document MUST partition that document's
  post-frontmatter text — total coverage, no gaps, no overlaps.
- **FR-006**: A section whose body exceeds 3,000 characters MUST be split into child units,
  preferring boundaries between list items and falling back to paragraph boundaries. Splitting
  MUST NOT cut inside a fenced code block.
- **FR-007**: A split MUST NOT emit a child below 300 characters; such a part is merged into an
  adjacent one instead.
- **FR-008**: Child units MUST reference their parent section; parent sections MUST have no
  parent reference.
- **FR-009**: Classification of units by heading category MUST be removed, along with the
  associated confidence marker and the report of unclassified headings, which no longer has
  anything to report.

**Identifiers**

- **FR-010**: A section unit's identifier MUST be derived from its source, its concept, and its
  heading path, with each path segment reduced to a slug truncated to 40 characters.
- **FR-011**: A child unit's identifier MUST extend its parent's with a hash of the child's own
  text, not with an ordinal position.
- **FR-012**: Identifiers MUST be stable across repeated builds of unchanged sources, and the
  build MUST fail rather than overwrite if two units resolve to the same identifier.

**Term lookup**

- **FR-013**: Every string that can identify a concept — its identifier, its display name, its
  document title, and the display name with and without a trailing "pattern" — MUST become an
  entry in a single lookup index.
- **FR-014**: Normalisation for that index MUST lowercase and remove all non-alphanumeric
  characters, and MUST have exactly one implementation shared by every producer and consumer of
  the index.
- **FR-015**: A normalised phrase MUST map to at most one concept. Two concepts producing the
  same phrase is a build failure, and the build MUST report every conflict before failing.
- **FR-016**: Duplicate phrases arising within a single concept MUST be silently reduced to one
  entry, recording the highest-precedence origin in the order identifier, name, title, alias.
- **FR-017**: Each entry MUST retain the original unnormalised form for inspection.
- **FR-018**: Concepts referenced by existing relationship edges but never admitted MUST be
  created as records marked as candidates with no material.

**Concept vectors**

- **FR-019**: Every concept record MUST have a vector computed from its display name, its lookup
  terms, and the opening of its definition text where material exists.
- **FR-020**: The combined text submitted for vectorisation MUST NOT be persisted as a field.
- **FR-021**: Unit-level vectors MUST NOT be computed or stored; the storage for them exists but
  remains empty.
- **FR-022**: The build MUST report similarity distributions for a positive baseline and a
  negative baseline over the concept set, as the evidence a later threshold will be calibrated
  against.
- **FR-025**: The call to the external embedding service MUST originate from the inference
  service, which already holds the provider credential, and MUST be reachable over the existing
  service interface. No component outside the inference service may hold that credential or
  call the provider directly.
- **FR-026**: Storing vectors and comparing them MUST remain with the persistence service. The
  inference service produces a vector and returns it; it does not store one, does not read one,
  and does not perform similarity search. Similarity between stored vectors is a database
  operation on the persistence side.
- **FR-027**: Declared capabilities that do not exist MUST be removed. The persistence service
  currently declares a dependency on a model-provider client and on a graph-orchestration
  library, neither of which it uses anywhere; under FR-025 the first must not exist there at
  all, and the second belongs to the inference service.

**Build behaviour**

- **FR-023**: Rebuilding from unchanged sources MUST produce an identical result and MUST NOT
  duplicate stored units.
- **FR-024**: A concept record naming an absent source file MUST fail the build with that
  concept named.

### Key Entities

- **Concept**: a named idea admitted to the corpus by a person. Carries an identifier that may
  never be renamed, a display name, its relationships to other concepts, whether material exists
  for it, its admission status, and its vector. It no longer carries a list of alternative names
  — those move to the lookup index.
- **Concept term**: one phrase that identifies exactly one concept. Carries the normalised
  phrase as its key, the original form, the concept it identifies, and where the phrase came
  from. The index as a whole is a single namespace: a phrase belongs to one concept or the build
  fails.
- **Document unit**: one contiguous span of one source document. Carries its heading path, its
  text, its offset and length within the source, its concept, its optional parent unit, its
  source URL and licence flag, and storage for a vector that this feature leaves empty. It no
  longer carries a heading category, a category-confidence marker, a context prefix, or a
  standalone label — the heading path supersedes the last two.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Byte coverage of admitted documents is exactly 100% — every byte of
  post-frontmatter source is claimed by exactly one stored unit, with zero unclaimed and zero
  double-claimed. Current pipeline: 27%.
- **SC-002**: Text that previously never reached storage at all is now present: all 49 documents
  contribute their opening definition, roughly 29,000 characters that were invisible to both the
  pipeline and its loss report.
- **SC-003**: Every phrase in the lookup index resolves to exactly one concept, verified over
  the concept records without a database.
- **SC-004**: Two consecutive builds from unchanged sources produce byte-identical identifiers,
  spans and unit counts.
- **SC-005**: The number of concepts that are known but have no material is reported rather than
  hidden — expected to rise from 0 to approximately 20 as unreferenced relationship targets
  become records.
- **SC-006**: The separation between the positive and negative similarity baselines is reported
  as a number, so the decision about whether the current vector representation is adequate is
  made on evidence rather than assumption.
- **SC-007**: Any regression that drops source text fails the build, rather than producing a
  smaller corpus that looks healthy.
- **SC-008**: Exactly one process holds the model-provider credential, unchanged from today.
  The pending migration from a long-lived key to a role-based credential therefore remains a
  single piece of work rather than two.

## Assumptions

- **Corpus scope is unchanged.** Only the sources already admitted are processed — the same 49
  concepts over 58 files. Extending to further directories is explicitly deferred until the
  end-to-end loop runs (`docs/DECISIONS.md`, "Run the loop end to end before expanding the
  corpus").
- **No hand-authored alternative names.** All lookup entries are derived by rule. Hand-authored
  aliases are deferred until a measurement identifies which category automatic resolution
  actually fails on; the lookup index reserves an origin value for them so that adding them
  later is additive.
- **300 characters is the minimum useful child size.** This is a reasonable default rather than
  a measured threshold — the measured distribution shows 27.6% of sections are already below 500
  characters and are not split at all, so the floor only governs split remainders.
- **The size limit is a target, not an invariant.** A protected code fence may carry a unit past
  3,000 characters, which is preferred over cutting inside it.
- **Existing identifiers may change once.** Every current unit identifier changes because the
  heading-category segment is removed. Nothing outside the build references them yet, so this is
  acceptable exactly once and is recorded as such.
- **The concept seed must be under version control.** The build reads the human-curated concept
  records; until recently those existed only in one working copy. This feature assumes that fix
  has landed.
- **Vector dimensionality is 1536 and revisable.** Recorded reasoning: at this scale
  dimensionality is not a cost variable, and reducing it would cost exactly the near-synonym
  resolution this corpus needs. The calibration output in FR-022 is the evidence that would
  justify changing it.

## Dependencies

- The human-curated concept records must be tracked in version control before the build can run
  reproducibly (addressed on a separate branch).
- Source documents are re-fetched and verified against the recorded checksums rather than read
  from a committed copy.
- Computing concept vectors requires the inference service to be running and to have its
  provider credential available, in the same way the corpus build already requires a database.
  This adds a second runtime dependency to what is otherwise an offline batch process.
- The interface between the two services gains one operation. This is a boundary change, which
  is why this feature is on the full planning flow.

## Out of Scope

- Hand-authored alternative names for concepts.
- Unit-level vectors — the storage is created, the values are not.
- Extending the corpus to further source directories.
- Any HTTP surface, user interface, or graph rendering.
- Question generation and everything downstream of it.
- Removal of the superseded training-directions pipeline, which lands with the next feature
  alongside the new interface.
