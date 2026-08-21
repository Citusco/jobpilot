# Feature Specification: JD Concept Graph

**Feature Branch**: `007-jd-concept-graph`

**Created**: 2026-08-21

**Status**: Draft

**Input**: User description: "JD-to-concept-graph pipeline: extract, resolve, and a graph endpoint. Make the corpus reachable from a job description end to end for the first time. A JD goes in, technical items come out, each item resolves to a concept or is recorded as unresolved, and one endpoint returns the concept graph with per-concept relevance so a client can render it. Also removes the superseded training-directions pipeline."

## Context

This is the first time a job description reaches the corpus. Everything built so far is offline:
70 concepts, 607 stored chunks, a term lookup and concept vectors, none of which any request
path touches. This feature closes that gap and deletes the superseded pipeline it replaces.

`docs/DECISIONS.md` is authoritative — the fifteen `2026-08-10` entries plus the `2026-08-11` and
`2026-08-21` corrections. Five sections of `docs/DESIGN.md` are marked `[SUPERSEDED 2026-08-10]`
and must not be followed.

**Measurements taken before writing this spec**, against the real corpus and the stored vectors:

| Measured | Value | Consequence for this feature |
|---|---|---|
| Whole graph serialised | 12.4 KB (70 nodes, 107 authored edges) | Returned in one response — no pagination, no subgraph endpoint |
| Authored edges alone | mean degree 3.1, 4 isolated nodes | Too sparse to be useful on its own |
| Concept-pair similarity | p5 0.248, p50 0.351, p95 0.484 | Narrow — edge count is extremely sensitive to the cut |
| Union at similarity ≥ 0.44 | 346 edges, mean degree 9.9, 0 isolated | The density target |
| Union at similarity ≥ 0.40 | 605 similarity edges alone | Visibly over-connected |

Derived edges were spot-checked and are not noise: the four gateway patterns cluster together,
and `messaging`/`messaging-bridge`, `compute-decision-tree`/`compute-options`,
`gateway-offloading`/`gateway-routing` are real relationships the source documents never linked.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A job description reaches the corpus, and what it missed is visible (Priority: P1)

Someone pastes a job description. The system pulls out the technical items it mentions and, for
each one, either names the concept it refers to or records that nothing in the corpus matches.
Both outcomes are first-class: a term the corpus does not cover must be reported as uncovered,
never quietly dropped and never forced onto the nearest concept.

**Why this priority**: it is the whole point of the corpus. Until this exists, 70 concepts and
607 chunks are unreachable from any input. It is also the only story that can be judged without
anything downstream of it.

**Independent Test**: submit a job description and read the per-item breakdown — resolved items
with their concept, unresolved items with the phrase that failed. Delivers a truthful account of
what this corpus can and cannot say about a given role.

**Acceptance Scenarios**:

1. **Given** a job description naming technical work, **When** it is submitted, **Then** each
   technical item appears once with the phrase as written and the span of text it came from.
2. **Given** a posting containing citizenship, clearance, location, salary and soft-skill
   requirements, **When** it is processed, **Then** none of those becomes an item.
3. **Given** an item whose phrase exactly matches a known way of naming a concept, **When** it is
   resolved, **Then** it resolves to exactly that concept, deterministically and without
   consulting any similarity measure.
4. **Given** an item phrased in a way the corpus has never recorded, **When** it is resolved,
   **Then** it either matches a concept with a stated confidence above the calibrated threshold,
   or is recorded as unresolved — never silently assigned to the closest available concept.
5. **Given** a job description with no recognisable technical content, **When** it is submitted,
   **Then** it is accepted and every item comes back unresolved, rather than the submission
   being rejected as a whole.

---

### User Story 2 - The result is retrievable as something a client can draw (Priority: P2)

A client asks for the concept map for a submitted job description and receives, in one response,
every concept, how relevant each is to that posting, which concepts have material behind them,
and the connections between them — with connections the source documents asserted kept distinct
from connections inferred from similarity.

**Why this priority**: it is what makes the previous story visible, and it is the contract the
next feature's interface is built against. It depends on US1 but is testable on its own against a
stored result.

**Independent Test**: request the graph for a processed job description and check the response
against the measured shape — every concept present, relevance populated, the two edge kinds
separately labelled, connection density in the intended range.

**Acceptance Scenarios**:

1. **Given** a processed job description, **When** the graph is requested, **Then** one response
   contains every concept, with no second request needed for any part of it.
2. **Given** that response, **When** its edges are examined, **Then** each carries which kind it
   is, and an edge asserted by a source document is distinguishable from one inferred by
   similarity.
3. **Given** the density target, **When** the returned graph is measured, **Then** its mean
   connections per concept is near ten and no concept is left unconnected.
4. **Given** a concept the corpus knows of but holds no material for, **When** it appears in the
   response, **Then** it is marked as having no material, distinguishing it from a concept the
   system has never heard of, which simply does not appear.
5. **Given** two requests for the same processed job description, **When** their responses are
   compared, **Then** they are identical.

---

### User Story 3 - Resolution accuracy rests on measured evidence, not a guessed number (Priority: P3)

The threshold separating "this phrase means this concept" from "nothing here matches" is derived
from measured distributions and re-derivable whenever the underlying representation changes,
rather than being a number someone chose.

**Why this priority**: it governs how much of US1's output can be trusted, but the pipeline runs
without it. It is placed last because it is the part most likely to reveal that something earlier
needs changing, and that is cheaper to discover with the pipeline already working.

**Independent Test**: run the calibration and read the separation between the two baselines as a
number, then check that the chosen threshold falls between them.

**Acceptance Scenarios**:

1. **Given** a set of phrases that must match a known concept and a set that must not, **When**
   calibration runs, **Then** it reports both distributions and the separation between them.
2. **Given** those distributions, **When** a threshold is chosen, **Then** it is derived from
   them rather than supplied by hand, and the derivation is repeatable.
3. **Given** distributions that overlap so far that no threshold separates them, **When**
   calibration runs, **Then** it says so explicitly rather than emitting a number that looks
   authoritative.
4. **Given** the calibration inputs, **When** they are inspected, **Then** the phrases used to
   test matching did not come from the same records the matching is performed against.

---

### Edge Cases

- The same phrase appears twice in one posting — it becomes one item, not two, and the evidence
  records both places it occurred.
- A phrase resolves at the deterministic tier to a concept that is nonetheless the wrong one:
  `rate limiting` names one concept exactly while colloquially usually meaning another. The
  deterministic tier cannot be overridden, so the neighbouring concept must still surface through
  the connection structure.
- A posting so long that extraction is unreliable — the boundary must be defined and exceeded
  input rejected with a reason, rather than silently truncated.
- A concept the corpus knows of only because another concept refers to it, whose relevance can
  only be weakly estimated because it has no material — this must not be presented with the same
  confidence as a concept that does.
- A referenced concept that is not a concept at all: the corpus currently carries a navigation
  page as one, which produces a strong but meaningless similarity to a genuine concept with a
  similar name. Admission of referenced concepts needs an exclusion rule.
- Every item in a posting resolves — the response must still be a complete graph, not only the
  matched part.

## Requirements *(mandatory)*

### Functional Requirements

**Extraction**

- **FR-001**: The system MUST turn job-description text into a list of technical items, each
  carrying the phrase as it appears and the span of source text that justifies it.
- **FR-002**: Non-technical requirements — citizenship, clearance, location, notice period,
  salary, soft skills, application logistics — MUST NOT become items.
- **FR-003**: Repeated mentions of the same phrase MUST produce one item, retaining every
  occurrence as evidence.
- **FR-004**: A submission with no recognisable technical content MUST be accepted and yield
  all-unresolved items. Whole-submission rejection on grounds of insufficiency is removed; the
  per-item unresolved state replaces it.
- **FR-005**: Input beyond a defined length MUST be rejected with a stated reason rather than
  truncated.

**Resolution**

- **FR-006**: Resolution MUST first attempt an exact match of the normalised phrase against the
  recorded ways of naming a concept. A match at this tier is deterministic, yields exactly one
  concept, and MUST NOT consult any similarity measure.
- **FR-007**: When the exact tier does not match, the system MUST compare the phrase against
  concept representations and return the best match only if it exceeds the calibrated threshold.
- **FR-008**: Below the threshold the result MUST be `unresolved`, carrying the phrase and the
  best score seen. Assigning the nearest concept regardless of score is prohibited.
- **FR-009**: Every resolution MUST record which tier produced it, so that a wrong answer can be
  traced to a recorded name versus an inferred match.
- **FR-010**: Concepts with no material MUST be resolvable but MUST NOT be judged against the
  same threshold as concepts with material, because their representations are built from names
  alone and are correspondingly weaker.

**Graph**

- **FR-011**: One request MUST return the complete graph for a processed submission: every
  concept, its relevance to that submission, whether it has material, and every edge.
- **FR-012**: Each edge MUST state its kind. Edges asserted by a source document and edges
  inferred from similarity MUST remain distinguishable and MUST NOT be merged into a single
  undifferentiated relatedness.
- **FR-013**: Inferred edges MUST be included by choosing the cut that reaches a target
  connection density, not by fixing a similarity value. The target is a mean of approximately ten
  connections per concept with no unconnected concepts.
- **FR-014**: Edges MUST carry a strength that a client can render.
- **FR-015**: The same submission MUST produce the same graph on every request.

**Calibration**

- **FR-016**: The threshold MUST be derived from two measured distributions: phrases that must
  match a given concept, and phrases that must not.
- **FR-017**: The phrases used for the matching baseline MUST NOT be drawn from the same records
  that resolution matches against, or the measurement is circular.
- **FR-018**: Calibration MUST report the separation between the distributions, and MUST state
  explicitly when they overlap too far for any threshold to separate them, rather than emitting a
  number regardless.
- **FR-019**: Calibration MUST be repeatable on demand, so that it can be re-run whenever the
  underlying representation changes.
- **FR-019a**: The matching baseline for this feature MUST be built from text belonging to each
  concept's own source material, asking whether a concept is recognised from its own words. The
  non-matching baseline MUST use text belonging to a different concept.
- **FR-019b**: The calibration MUST record which baseline it used, so that a threshold derived
  from concept-document phrasing is never mistaken for one derived from real-world phrasing. It
  is a floor: failure here means the representation is inadequate and no wording will help, while
  success does not establish that the words a person would type will match.

**Persistence**

- **FR-024**: A submission MUST be stored with its original text, the time it was received, and
  the items extracted from it with their resolution outcomes.
- **FR-025**: Stored submissions MUST survive the removal of the old pipeline's fields; the
  identifier remains stable so that later work can reference a submission recorded now.
- **FR-026**: Storage MUST NOT become a read dependency of this feature. The graph is derivable
  from a submission's stored items, but nothing here may require a prior submission to exist.

**Removal of the superseded pipeline**

- **FR-020**: The training-directions pipeline MUST be removed in full — its stored model, the
  submission fields that only served it, its request handling, its response contract, and the
  orchestration node and schemas behind it.
- **FR-021**: Product-agnostic scaffolding MUST survive the removal: database access, health
  checking, the cross-service client and its module, the model client and credential loading, the
  service scaffolding, the orchestration wiring pattern, and the development and test toolchain.
- **FR-022**: No behaviour of the removed pipeline may be depended upon by the new one; in
  particular the whole-submission sufficiency gate is not reinstated in another form.

**Data quality**

- **FR-023**: Admission of concepts known only through references MUST exclude entries that are
  not concepts. The corpus currently admits a navigation page this way.

### Key Entities

- **Submission**: one job description as given, stored, plus the items extracted from it and
  when it was received. Its previous fields describing role, stack, seniority and status belonged
  to the removed pipeline and do not survive. Nothing in this feature reads a submission back;
  it is stored because the text is user-supplied and not reproducible, and because the coverage
  benchmark and the gap queue will both need the history that starts accumulating now rather
  than whenever those are built.
- **Extracted item**: one technical phrase found in a submission — the surface form, the evidence
  span or spans, and its resolution outcome.
- **Resolution outcome**: either a concept with the tier that produced it and, for the inferred
  tier, a score; or unresolved with the best score seen.
- **Graph node**: a concept as presented to a client — its identity, display name, relevance to
  this submission, and whether material exists for it.
- **Graph edge**: a connection between two concepts — the pair, its kind (asserted by a document
  versus inferred from similarity), and its strength.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A job description submitted to the system yields a concept map, end to end, with no
  manual step. This has never been possible before.
- **SC-002**: Every extracted item ends in exactly one of two states, resolved or unresolved.
  Neither silent omission nor forced assignment occurs in any test case.
- **SC-003**: The complete graph is returned in a single response of roughly 12 KB, matching the
  measured size. No client needs a second request to draw it.
- **SC-004**: The returned graph averages about ten connections per concept with no unconnected
  concept, against the 3.1 and four isolated concepts that the authored edges alone provide.
- **SC-005**: Asserted and inferred connections are distinguishable in the response, and the
  proportion of each is reportable.
- **SC-006**: The threshold in use is traceable to a recorded calibration run, and re-running it
  reproduces the same value on unchanged inputs.
- **SC-007**: For a job description the corpus genuinely does not cover, the system reports high
  unresolved coverage rather than a populated map. Being able to say "this corpus does not cover
  this role" is a correct outcome, not a failure.
- **SC-008**: No part of the removed pipeline remains reachable, and everything the new pipeline
  reuses continues to pass its existing tests.
- **SC-009**: Every submission processed is retrievable afterwards with its text and its items,
  so that the record needed by later coverage measurement starts accumulating from the first
  request rather than from whenever that measurement is built.
- **SC-010**: The calibration states which baseline produced the threshold in force, so that a
  floor established from concept-document phrasing is never read as evidence about real-world
  phrasing.

## Assumptions

- **The corpus is unchanged.** 49 concepts with material plus 21 known through references; no new
  sources. Corpus expansion is deferred until the loop runs.
- **No hand-authored alternative names.** The recorded ways of naming a concept remain the ones
  derived by rule. The reserved type for hand-authored ones stays unused, so adding them later is
  a data change.
- **Relevance is per concept per submission**, derived from the items that resolved to it.
  Concepts nothing resolved to appear with zero relevance rather than being omitted — the client
  needs the whole map to show what was not matched.
- **The density target is approximately ten connections per concept**, chosen from the measured
  union rather than from theory. It is a display property and expected to be tuned once there is
  a client to look at.
- **The graph is the same for every client**; there is no per-user state.
- **Concepts known only through references keep weaker representations** in this feature. Giving
  them material is corpus work, not pipeline work.
- **Submissions are stored from the first request**, though nothing in this feature reads one
  back. The reasoning is that job-description text is user-supplied and not reproducible, and the
  submission table is being reshaped here anyway — adding columns now costs nothing, while adding
  them later means a migration plus reprocessing whatever has accumulated.
- **The threshold this feature produces is a floor, not a verdict.** It is calibrated from
  concept-document phrasing, which establishes whether the representation can distinguish
  concepts at all. Whether real job-description wording reaches the right concept is a separate
  measurement, gated on postings for roles the corpus covers.

## Dependencies

- The corpus layer delivered in feature 006: concept records, the term index, concept vectors,
  and stored chunks.
- The inference service must be running, both for extraction and for embedding phrases that the
  exact tier does not match.
- The threshold is calibrated in two stages, and only the first is in this feature. Stage one
  draws its phrases from each concept's own source document, which is independent of the term
  index that resolution matches against and is available today. Stage two uses phrasings taken
  from real job postings and is deferred until postings exist for roles this corpus actually
  covers — the four collected so far are for AI-agent roles it does not, where a low match rate
  would report corpus coverage while looking like poor matching.

## Out of Scope

- The visual concept map. This feature produces the data; rendering it is the next feature.
- Hand-authored alternative names for concepts.
- Chunk-level vectors and any retrieval below concept level.
- Corpus expansion to further sources.
- Question generation and everything downstream of it.
