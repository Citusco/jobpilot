# Feature Specification: Corpus Expansion

**Feature Branch**: `008-corpus-expansion`

**Created**: 2026-08-22

**Status**: Draft

**Input**: User description: "Corpus expansion: give the grey concepts material and cover AI-engineering vocabulary. Two measured problems, one action. Every grey concept has a page in the pinned Azure commit that was never fetched. And five real job descriptions resolved 1 of 146 items, because the corpus is Azure architecture patterns while the postings ask about agents, RAG, prompt engineering and evaluation. Also fixes a defect that recurs on every refetch."

## Context

Two problems measured after the pipeline first ran end to end, both traceable to the same cause:
the corpus reaches only two directories of a repository that has thirty-nine.

| Measured | Value |
|---|---|
| Real job postings for the target roles | 5 postings, 146 extracted items, **1 resolved** (0.7%) |
| An architecture-flavoured posting, for contrast | 8 items, **6 resolved** |
| Concepts known only through a link, with no material | 18 |
| Of those, ones that have a page at the pinned commit | **18 of 18** |
| Markdown files at that commit under `docs/` | 508, of which **58 are admitted** |
| Grey-to-grey inferred edges before they were excluded | 28.7%, against a random expectation of 8.1% |

The second and third rows are the same finding from two directions. Concepts with no material get
vectors built from a name and a term list, which makes short generic nouns cluster by word shape
rather than meaning — measured in SCRUM-45 and the reason grey concepts no longer generate
inferred edges. Giving them material removes the cause rather than the symptom.

`docs/DECISIONS.md` wins on any conflict. `docs/DESIGN.md` has five sections marked
`[SUPERSEDED 2026-08-10]`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every admitted concept has something behind it (Priority: P1)

A concept that appears in the map can be opened and read. Today eighteen cannot: the corpus knows
they exist only because another document links to them, so they render as points with nothing
behind them and their representations are built from a name alone.

**Why this priority**: it removes a defect rather than adding surface. The degenerate
representations distorted the graph badly enough that SCRUM-45 had to exclude those concepts from
inferred edges — a workaround this story makes unnecessary. It also needs no judgment call about
new subject matter: these concepts were already admitted, and the pages they refer to already
exist.

**Independent Test**: count concepts with no material before and after. Delivers a map where
every point opens onto something.

**Acceptance Scenarios**:

1. **Given** a concept currently known only through a link, **When** the corpus is rebuilt,
   **Then** it has source material and is no longer marked as lacking it.
2. **Given** the rebuilt corpus, **When** concept representations are compared, **Then** the ones
   that gained material are built from their own definition text rather than a name alone.
3. **Given** a link that points at something which is not a concept — a navigation or index page —
   **When** the corpus is rebuilt, **Then** it is not admitted, and the exclusion is recorded
   rather than hardcoded at the point of use.
4. **Given** the newly reachable files, **When** admission is decided, **Then** a person decides
   which become concepts, and the decision is a reviewable artifact rather than a side effect of
   which directories were fetched.

---

### User Story 2 - The corpus covers what the target job postings actually ask about (Priority: P2)

Someone applying for the roles this project was built for submits a posting and sees a map with
material behind it, rather than a near-empty one. Today the corpus answers questions about
distributed-system architecture, while the postings ask about retrieval, prompting, evaluation,
agents and model choice.

**Why this priority**: it is the reason the project exists, but it depends on US1's admission
process being in place, and it is the half that requires judgment about unfamiliar subject matter.

**Independent Test**: re-run the five stored postings and compare the resolved rate against the
recorded 1 of 146.

**Acceptance Scenarios**:

1. **Given** the five stored job descriptions, **When** they are re-resolved after expansion,
   **Then** the resolved rate is reported against the recorded baseline of 1 of 146.
2. **Given** material on retrieval, prompting, evaluation and agent design, **When** a posting
   mentions those, **Then** the items resolve to concepts that have material behind them rather
   than to nothing.
3. **Given** a newly admitted concept, **When** its material is inspected, **Then** it comes from
   a source whose licence permits citation, recorded per source as the existing corpus does.
4. **Given** the expansion, **When** coverage is still short for some vocabulary, **Then** that
   remains visible as unresolved rather than being papered over — a partial answer reported
   honestly is the intended outcome.

---

### User Story 3 - Refetching a source does not destroy it (Priority: P3)

Someone refetches a source and the local copy remains inspectable afterwards. Today the filtering
step deletes the fetched repository's own metadata, so nothing downstream can ask which commit is
checked out or what else the repository contains.

**Why this priority**: it blocks nobody today, because the fetch path recreates everything from
scratch. But it silently removes the ability to verify a fetched source against its record, and
this feature's whole premise came from a query the damage prevented.

**Independent Test**: fetch a source, filter it, then ask the local copy which commit it holds.

**Acceptance Scenarios**:

1. **Given** a freshly fetched source, **When** filtering runs, **Then** the source's own metadata
   survives and the local copy still reports the commit it was pinned to.
2. **Given** the two places in the filtering step that decide what to leave alone, **When** they
   are compared, **Then** they answer that question the same way.

---

### Edge Cases

- A newly reachable file that is a navigation page, an index, or a list of links rather than a
  concept — it must not become a concept, and the same rule must cover the three already
  identified.
- A file whose subject overlaps an existing concept — for example material on caching when a
  caching concept already exists as a stub. The existing identifier must be reused, never
  renamed and never duplicated, since identifiers are referenced elsewhere.
- Two newly admitted concepts whose names normalise to the same phrase — the build must fail and
  report it, as it already does, rather than silently keeping one.
- A newly reachable file that is a reference architecture or solution walkthrough rather than a
  concept: it describes an assembled system, not an idea, and admitting it would add a concept
  that no job description will ever name.
- Expansion increases the number of concepts. Their vectors are compared against each other for
  graph edges and against phrases for resolution; both were already weak, and more concepts is
  not automatically better for either.
- A source page that exists at the pinned commit but has since been removed upstream — the pin
  makes this reproducible, and refetching must continue to reproduce the recorded state.

## Requirements *(mandatory)*

### Functional Requirements

**Reaching the material**

- **FR-001**: The corpus configuration MUST reach the pages that currently-admitted concepts refer
  to. All eighteen exist at the pinned commit, spread across nine directories, so reaching them
  necessarily makes many neighbouring files reachable too.
  [NEEDS CLARIFICATION: how widely? Measured candidate counts at the pinned commit — whole parent
  directories: 262 files; narrowed to the specific subdirectories containing the eighteen: 145;
  the AI-engineering material alone, skipping the grey pages entirely: 52. Every candidate needs
  a human admission decision under FR-005, so this choice sets how much reviewing the feature
  costs.]
- **FR-002**: The corpus configuration MUST reach the source's material on retrieval, prompting,
  evaluation, agent design and model selection, and its catalogue of anti-patterns.
- **FR-003**: Expansion MUST remain within the pinned commit. Refetching MUST continue to
  reproduce the recorded bytes, verified per file against the existing checksum record.
- **FR-004**: Newly reachable files whose licence does not permit citation MUST NOT be admitted as
  citable, and the licence tier MUST be recorded per source as it already is.

**Deciding what becomes a concept**

- **FR-005**: Which newly reachable files become concepts MUST be a recorded human decision, not a
  consequence of which directories were fetched. Reaching a file and admitting it are separate
  steps.
- **FR-006**: Files that are navigation pages, indexes, reference architectures or solution
  walkthroughs MUST NOT become concepts. The rule MUST cover the three navigation pages already
  identified and MUST live with the admission decision rather than being applied at the point of
  use.
- **FR-007**: A concept that already exists MUST keep its identifier when it gains material. No
  identifier may be renamed, and no second concept may be created for the same subject.
- **FR-008**: The admission decision MUST be reviewable before it takes effect — a person can see
  what would be admitted, and rejected candidates are recorded with the fact that they were
  considered.

**Rebuilding**

- **FR-009**: After expansion, every concept that has material MUST be marked as having it, and
  the count of concepts without material MUST be reported.
- **FR-010**: Concept representations MUST be rebuilt so that concepts which gained material are
  built from it. Leaving a stale representation would preserve the defect this feature removes.
- **FR-011**: Total byte coverage of admitted documents MUST remain complete, as the existing
  assertion requires. Expansion must not become an exception to it.
- **FR-012**: Rebuilding MUST remain reproducible: the same sources produce the same identifiers,
  spans and counts.

**Fixing the filter**

- **FR-013**: Filtering MUST NOT modify or delete anything belonging to a fetched source's own
  metadata, including empty directories inside it.
- **FR-014**: The two places in the filtering step that decide what to leave alone MUST use the
  same rule.

**Measuring the result**

- **FR-015**: The five stored job descriptions MUST be re-resolved after expansion and the
  resolved rate reported against the recorded baseline of 1 of 146.
- **FR-016**: The resolution threshold calibration MUST be re-run and its result recorded,
  including whether the distributions now separate. It currently does not, and one candidate
  explanation is that representations were built from too little text.
- **FR-017**: Both measurements MUST be recorded whatever they show. An expansion that does not
  improve the resolved rate is a finding worth having, and the instrument exists so that the
  deferred decision about hand-authored alternative names can finally rest on evidence.

### Key Entities

- **Source configuration**: which repository, pinned to which commit, and which of its directories
  are reachable. This feature widens the last of these and changes neither of the others.
- **Concept**: unchanged in shape. Some existing ones gain material; some new ones are admitted.
  Identifiers are permanent.
- **Admission record**: the reviewable artifact naming which candidate files become concepts and
  which do not, and why the excluded ones were excluded.
- **Measurement record**: the resolved rate over the stored job descriptions and the calibration
  outcome, before and after, so the effect of the expansion is a number rather than an impression.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Concepts with no material fall from 18 to zero, or every remaining one is recorded
  with the reason it has none.
- **SC-002**: The resolved rate over the five stored job descriptions is reported against the
  recorded 1 of 146. The expansion targets the vocabulary those postings use, so an improvement is
  expected — but the number is reported whatever it is.
- **SC-003**: Byte coverage of admitted documents remains complete, with the expanded corpus held
  to the same assertion as the current one.
- **SC-004**: Every admitted concept traces to a recorded admission decision; none exists merely
  because its file happened to be inside a fetched directory.
- **SC-005**: A refetched source remains inspectable — its local copy still reports the commit it
  was pinned to after filtering.
- **SC-006**: Refetching reproduces the recorded bytes for every previously recorded file, as the
  pins already guarantee.
- **SC-007**: The calibration outcome after expansion is recorded, including if it still finds no
  separation. That result would say the representation needs changing rather than the corpus, and
  is worth knowing before anything else is tried.

## Assumptions

- **The pin does not move.** Expansion widens which directories are reachable at the same commit.
  Moving to a newer commit would mix a content change into a scope change and make the before and
  after measurements incomparable.
- **The chunker needs no change.** The newly reachable files come from the same repository with
  the same heading conventions as the admitted ones. If a file turns out not to follow them, it is
  a candidate for exclusion rather than a reason to change the chunker.
- **One file, one concept**, as with the currently admitted material. Sources where a concept
  spans several files need a different admission model and are out of scope.
- **More concepts is not automatically better.** Every admitted concept enters the graph and the
  resolution space. A file that no job description would ever name adds noise to both, which is
  why FR-006 excludes whole categories rather than admitting everything reachable.
- **The measurements are comparable.** The same five job descriptions, already stored, are
  re-resolved. Their extraction does not change; only what they can resolve against does.

## Dependencies

- The corpus layer from SCRUM-44 and the resolution pipeline from SCRUM-45, both merged.
- The pinned upstream commit remains fetchable. Its content is verified against the existing
  per-file checksums.
- Concept representations are rebuilt after expansion, which requires the inference service.

## Out of Scope

- The prose sources already fetched but never admitted — 391 files of agent-framework
  documentation, 58 of graph-orchestration, 16 of protocol documentation, 220 of vendor guidance.
  A concept there spans several files rather than one, so admission works differently. Their
  vocabulary overlaps what this feature adds, which is a reason to measure this expansion first.
- Hand-authored alternative names for concepts. This feature produces the evidence for deciding
  whether they are needed; writing them is separate.
- Unit-level representations, changing the representation model, and anything about the graph
  endpoint or a client.
