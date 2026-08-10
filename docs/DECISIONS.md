# JobPilot Decision Log

Append-only. New decisions are added at the end; existing entries are never edited or
removed — a reversed decision gets a new entry that supersedes the old one and links back
to it.

The entries below were backfilled on 2026-08-08 from `docs/DESIGN.md`, the product/
architecture redesign produced over roughly 15 rounds of discussion in a separate design
session. Each entry is sourced to the DESIGN.md section it came from; consult that section
for the full reasoning.

## 2026-08-08 — Priority: AI-engineering substance over product polish

**Decision**: at any fork in the design, prefer the branch with more AI-engineering
substance over the one that makes the product more polished (difficulty calibration
accuracy, question realism, coverage breadth are allowed to stay rough).
**Why**: the author's primary goal is learning AI engineering and using this project for
job applications; product usability is secondary.
**Status**: active
**Source**: DESIGN.md §0

## 2026-08-08 — Coding questions (live-coding / Judge0) abandoned

**Decision**: drop coding/live-coding questions entirely, along with Judge0, sandboxing,
harnesses, and code-based difficulty calibration. Also abandoned: mining real GitHub repos
for questions, a container runner for framework questions, multi-agent collaboration,
training retrieval on public academic datasets (SQuAD/MS MARCO/BEIR), and an agent that
autonomously discovers and ingests sources.
**Why**: coding questions are "too shallow to matter, too deep to be tractable"; the other
items were each downstream of that direction or independently rejected (see DESIGN.md §1
for the per-item rationale).
**Status**: active
**Source**: DESIGN.md §1

## 2026-08-08 — Product form: concept/decision questions with verbatim sourcing

**Decision**: the product takes a JD as input and outputs a syllabus of concept questions
in decision-question form (a scenario + 2-3 options, candidate must state a benefit, a
cost, and a choice condition per option). Every judgment must trace back to a verbatim
excerpt from an authoritative document — this is the product's core differentiator.
**Why**: a plain "what is X" recall question has no diagnostic value (if ChatGPT can
answer it, so can rote memorization); a decision question with sourced tradeoffs tests
whether the candidate can recognize a tradeoff exists, and doubles as this project's
central AI-engineering showcase (grounded RAG with verification, not just retrieval).
**Status**: active
**Source**: DESIGN.md §2

## 2026-08-08 — Retrieval must be up front; evidence strength is three-tiered; when_to_choose must be sourced; gaps drives corpus growth

**Decision**: four rules established from two hand-run generation experiments:
(1) retrieval happens before generation, not as post-hoc verification (post-hoc can only
discard, not correct); (2) evidence strength is `direct | weak | null`, not a binary
pass/fail; (3) `when_to_choose`, like benefit/cost, must be sourced to a verbatim excerpt
— it's a factual claim too; (4) the `gaps` array (recording why a field was left null) is
a first-class trigger for corpus-gap detection, not just an error log.
**Why**: Experiment 1 (no escape hatch for insufficient material) produced a citation that
existed verbatim but didn't support the claim it was attached to — `content.includes()`
passed it anyway. Experiment 2 (added "leaving a field null is acceptable, forcing a fit
is not") fixed this without collaterally damaging valid citations, and the model
spontaneously self-graded some evidence as "weak."
**Status**: active
**Source**: DESIGN.md §3 (see also the consolidated hard-constraint entry below)

## 2026-08-08 — Service split: NestJS owns persistence/retrieval, Python owns LLM orchestration

**Decision**: NestJS/TypeScript owns all persistence (including vector tables), the
retrieval layer, the concept graph, and diagnostic statistics. Python/FastAPI owns LLM
inference orchestration and the LangGraph state graph. Python never connects to the
database directly — it asks NestJS over HTTP.
**Why**: retrieval and inference are different engineering problems (information
retrieval + DB optimization vs. orchestration + state management); the boundary follows
"which side owns the data" vs. "which side follows the LLM ecosystem," not surface-level
appearance of "looking AI-related." Consistent with the existing Constitution Principle
IV — no amendment needed for this split itself.
**Status**: active
**Source**: DESIGN.md §4.1

## 2026-08-08 — LangGraph yes, LangChain no, for the new eight-step pipeline

**Decision**: the new extract → resolve → combine → retrieve → generate → verify pipeline
(DESIGN.md §4.2) uses LangGraph as a minimal state-machine layer but does not use
LangChain's core abstractions (LLM abstraction, Retriever/VectorStore abstraction,
Loaders, Splitters, LCEL/Chain) or its text splitters. `langchain-core`'s `@tool` is
deferred to P2 (the agent loop).
**Why**: LangGraph gives low-level structure (state, conditional edges) that the
retry/agent loops in §6 need, and its LangSmith node-level tracing is free eval
infrastructure. LangChain's abstractions each solve a swappable-implementation problem
this project doesn't have (provider is locked to OpenAI, retrieval is SQL not a
vector-store abstraction, all sources are markdown/HTML, the pipeline is linear) — and its
splitters cover only ~30% of the chunking spec while costing exact-reproducibility, which
verbatim verification depends on.
**Reconciliation with existing code**: this decision is scoped to the *new* pipeline only.
It does not apply retroactively to the already-shipped SCRUM-41 `agent-service` LLM client
(`agent_service/llm.py`), which deliberately uses `langchain_openai.ChatOpenAI` — a
separate decision, discussed and agreed on 2026-08-02, already recorded in
`.specify/memory/constitution.md` v2.1.0 Principle IV. The two are scoped to different
code paths and coexist without contradiction: LangChain stays in the locked stack for
existing/future code that wants it; the new pipeline in DESIGN.md simply doesn't reach for
it.
**Status**: active
**Source**: DESIGN.md §4.5

## 2026-08-08 — Two-table data model: `concept` (identity) vs. `doc_chunk` (source material)

**Decision**: model concepts and source material as two separate tables related by id,
with independent lifecycles. `concept` (~100-200 rows, human-curated) is a concept's
identity card — name, aliases, kind, related concepts, whether corpus material exists,
embedding — with no source text. `doc_chunk` (hundreds to thousands of rows) is one row
per chunk of source text, foreign-keyed to a concept via `pattern_id`. `concept_id`, once
written, may never be renamed (only superseded via `deprecated` + a new entry).
**Why**: a single `doc_chunk`-only model can only say "no material" when a JD mentions an
unknown term — it can't say what the term is, what category it's in, or what it relates
to, so the gap queue can't produce an actionable to-do. The concept table makes "known but
no material yet" a distinct, useful state. Renaming `concept_id` would sever the
`doc_chunk` foreign key and every historical answer record's label.
**Status**: active
**Source**: DESIGN.md §5

## 2026-08-08 — No multi-agent until an explicit trigger condition appears

**Decision**: multi-agent collaboration is not used at this stage. Its two legitimate
justifications — parallelism (context bandwidth) and isolation (hiding something from a
component) — don't apply: material fits in one context, and concept questions (unlike the
abandoned coding questions) have no hidden reference answer to protect. Do not pre-reserve
abstraction layers or split cohesive nodes "in case we need it later." Six concrete trigger
conditions are documented (context overflow, 5+ pattern merges overflowing tokens, a new
must-be-hidden scenario, unacceptable serial batch latency, multi-perspective work needing
to pass intermediate conclusions) — none have appeared yet. Lighter alternatives already
cover the need: one isolated LLM call (verify entailment) for uncontaminated judgment, an
agent loop (P2, gaps-driven re-retrieval) for runtime branching, a one-way subagent ("cold
reader," P3) for isolation, an LLM-as-judge ensemble for variance reduction.
**Why**: coding questions were the system's only "must be isolated" scenario; cutting them
removed the last multi-agent justification. Trigger-condition appearance means "discuss
it," not "start building."
**Status**: active
**Source**: DESIGN.md §6

## 2026-08-08 — License-tiered corpus admission (`citable` flag)

**Decision**: cache all fetched source material locally regardless of license, and use all
of it as LLM reference context — but only show verbatim excerpts to end users
(`citable: true`) for CC-BY/MIT/Apache/CC-BY-SA-licensed sources. Sources with unknown or
all-rights-reserved licensing are cached and used for internal reasoning only
(`citable: false`), never shown as source text, only linked externally. `citable` is set
automatically from license metadata, not judged by hand per file.
**Why**: gets the content value (deciding what to question on, which options to compare)
without constituting redistribution of non-licensed text. Discovered via a real case
(microservices.io confirmed all-rights-reserved via a footer scan).
**Status**: active
**Source**: DESIGN.md §7.4

## 2026-08-08 — Chunk to H3, not just H2; item-level split inside tradeoff sections

**Decision**: source documents are chunked on both `##` and `###` headings (not H2 alone),
with code fences protected from splitting, kind classified by case-insensitive regex on
the heading text (`cost`/`benefit`/`when`/`example`/`meta`), and a further item-level split
inside cost/benefit/when blocks on a `- **Label.** body` bullet pattern. A contextual
source-path prefix is concatenated (never rewritten) onto each chunk.
**Why**: observing the actual raw Azure CQRS document showed most benefit/cost content
lives at H3 under a shared H2 (e.g., "Benefits of CQRS" nested under "## Solution") — H2-
only chunking would bury or lose it entirely, which is exactly what happened to an earlier
aggregate heading-frequency report that only counted H2s. Chunking rules must come from
observing real data, not assumptions about document structure. LLM-based ("smart")
chunking was explicitly rejected: it isn't reproducible run-to-run, and non-reproducible
chunk boundaries would silently break verbatim verification (see the consolidated
hard-constraint entry below).
**Status**: active
**Source**: DESIGN.md §7.5, §7.6

## 2026-08-08 — Vector search only at `resolve`, never at `retrieve`

**Decision**: vector search (with an auto-calibrated similarity threshold, from positive/
negative baseline distributions) is used only in the `resolve` step, to map natural-
language JD terms to `concept_id`s when the alias table misses. The `retrieve` step, which
takes an already-resolved exact id, is a plain SQL lookup with no vector component.
Embedding model can stay English-only (`text-embedding-3-small`) since JD extraction input
is English; cross-language need, if any, lives on the user-interaction side (P3), not
extraction.
**Why**: ambiguity should be concentrated in a small number of pipeline nodes and resolved
before it propagates — this makes debugging retrieval issues unambiguous (a wrong result
is always resolve's or combine's fault). retrieve would only need vector search if it
became a filtering problem (a pattern with 50+ candidate chunks) rather than an exhaustive
fetch, or for a future material-recommendation feature. A threshold is mandatory: an
unthresholded "most similar wins" match is a silent error, worse than an explicit
`unresolved`.
**Status**: active
**Source**: DESIGN.md §8

## 2026-08-08 — Seven hard constraints (consolidated)

**Decision**: seven non-negotiable constraints govern all future work on this pipeline —
see `docs/DESIGN.md` §12 and the "Seven hard constraints" section of `CLAUDE.md` for the
full text. Summary: (1) never let an LLM paraphrase/clean/summarize source text; (2) never
rename a `concept_id` once admitted; (3) `includes()` substring checks alone are
insufficient — require an independent entailment judgment; (4) that entailment check's
input must be isolated to just `claim` + `verbatim`; (5) never split benefit/cost/when
into separately-generated pieces; (6) vector matching must have a calibrated threshold;
(7) corpus admission (adding a new source or concept) is a human decision — an LLM may
propose candidates but must never touch source text or make the admission call itself.
**Why**: each of these was derived from a specific failure mode observed in the two
generation experiments (§3) or from reasoning about where silent, hard-to-detect damage
could occur (e.g., a renamed `concept_id` breaking every historical answer record without
any error being thrown).
**Status**: active
**Source**: DESIGN.md §12

## 2026-08-08 — Measurement-first discipline for data-dependent claims in spec work

**Decision**: before `/speckit-specify`, when a feature description contains a claim
about data that already exists in the repository or is otherwise measurable — corpus
shape, file counts, heading distributions, expected LLM output shape, existing table
contents — that claim is verified by measurement first, and the measured numbers (with
their counting basis stated) go into the feature description rather than the source
document's characterization of them. A useful test: for every number and every quantifier
("mostly," "highly consistent," "the majority") in a draft spec, ask whether someone
counted it or someone believed it.

Two parts of this are the most likely to be lost if only summarized, so they're stated in
full:

1. **The counting basis must be stated alongside every number.** Two separate rounds of
   correction in the feature that produced this decision (`specs/005-corpus-ingest-
   foundation`) were caused by counts silently switching between an H2-only and an H2+H3
   basis — the resulting figures looked like corrections but were measuring something
   different from what they replaced, and nothing about the number itself signaled that.
2. **An agent that identifies an unverified data-dependent claim must stop and surface
   it for a human decision — not measure autonomously and then proceed on its own
   numbers.** Deciding what to measure, on what basis, and whether the result changes the
   design are judgment calls. The feature that produced this decision generated two
   incorrect self-corrections (a counting-basis switch, and a 1-2 count drift on
   re-verification) precisely at the points where measurement was performed without that
   judgment being applied by a human. The agent's job is to flag the claim and say what
   would settle it; the decision to measure, and the reading of the result, stay with the
   human.

**Scope note**: this does not apply to design intent, product decisions, or anything not
yet observable — those are what `spec.md` is for.

**Why**: this feature's review found that three separate claims `spec.md` had inherited
from `docs/DESIGN.md`, and written into a requirement or a success criterion before anyone
counted, were false when measured against the actual azure corpus: that benefit content is
mostly at H3 and that splitting to H3 "recovers" it (§7.5 — the real count is 9 benefit
headings corpus-wide, only 3 of them at H3); that the bold-label bullet pattern is "highly
consistent" across the corpus (§7.5 — the specified form matches 5.6% of bullets, and
77.8% carry no label at all); and that aspnet's templates are worth including as "buried
gold" for this purpose (§7.2 — measured, they supply `when` in volume but contain no
benefit-bearing template at all). This is the exact failure mode DESIGN.md §7.5 documents
about itself — "chunking rules must be based on actually observing the raw data, not
assumptions about document structure" — and it recurred here because the observation step
happened after the spec was written rather than before it.
**Status**: active
**Source**: `specs/005-corpus-ingest-foundation`'s review process (`research.md` §6,
`checklists/requirements.md`'s correction-pass notes)

## 2026-08-09 — `doc_chunk` granularity is a frozen contract; three schema additions

**Decision**: chunk granularity — one chunk per classified H2/H3 section, or per labelled
item within a cost/benefit/when section — is a fixed contract that future sources adapt to,
not a parameter revised per source. A new source type gets a new *preprocessing method* that
must produce chunks satisfying the same contract; it does not get its own granularity, and
it does not get a parallel database. All methods write to the same `doc_chunk` table and are
distinguished by `kind_confidence` (`regex | llm | manual`).

Three changes follow from freezing it, since anything not decided now becomes a migration
plus a full re-ingest later:

1. Add `parentChunkId` (nullable). The parent section is known for free at chunk time. Add
   the column, but do **not** wire it into retrieval — the small-to-big retrieval pattern it
   would enable presupposes vector search over chunks, and retrieval is an exhaustive
   `pattern_id` lookup (DESIGN.md §8). It is stored to keep the option open, not to be used.
2. Add `sourceOffset` and `sourceLength`. Verified against the real corpus: all 425 chunks
   are single contiguous spans of their source file, so an offset pair describes each chunk
   exactly. This upgrades "content is a literal substring" from a substring search to a
   byte-range comparison, and it is the only mechanism that makes coverage, overlap and gaps
   computable once more than one chunking method writes to the table.
3. Remove the `unmapped` value from the `ChunkKind` enum — see the next entry.

**Why**: the "granularity is a fixed contract" framing came from the project owner and is
stronger than what DESIGN.md states. It makes the downstream shape — what `retrieve` returns,
what `generate` consumes — stable by construction, and it matches how the schema was already
written: `DocChunk` has no source-type-specific fields, and `kind_confidence` already assumes
granularity is universal while method varies.

**Known limitation, recorded rather than fixed**: 34 of the 60 `when`-kind chunks (57%)
contain "this pattern might not be suitable when" material, which is semantically *cost*
content stored under `when` because that is the heading it sits under — the same mixed-section
hazard DESIGN.md §9④ describes. It surfaced during the generation experiments below, where a
`cost` claim was correctly supported by a verbatim excerpt drawn from a `when`-kind chunk.
`kind` therefore describes where text came from, not what it may support.
**Status**: active

## 2026-08-09 — Unclassified sections are not stored; "no data loss" is guaranteed at the source layer

**Decision**: sections matching no `kind` rule are not written to `doc_chunk`. They split into
two buckets — discarded (one-off implementation headings: function names, flow steps,
deployment-specific titles) and retained (headings whose content is worth revisiting,
principally `Solution` and `Context and problem`). The retained bucket is a lightweight list
(heading, file, occurrence count), a separate artifact from `doc_chunk`, with no `content` and
no `chunk_id`. Since neither bucket produces a `doc_chunk` row, the `unmapped` enum value is
removed.

**Why**: `specs/005`'s US2 acceptance scenario 1 required unclassified sections to be "still
stored ... rather than silently dropped", and `unmapped` was that requirement's
implementation. But it conflated two things: *"don't silently drop"* is a visibility
guarantee, while *"store it in the table"* is a storage mechanism. The guarantee already lives
one layer down.

The corpus has three layers, and each guarantee belongs to exactly one:

* **Source layer** (`corpus/sources.yaml` pinned to a commit, plus a sha256 per file in
  `corpus/_meta/manifest/`) — the raw text is byte-for-byte reproducible and verifiable.
  *"Nothing is lost"* lives here.
* **Report layer** (`corpus/reports/unmapped-headings-*.md`) — you know what was not
  classified. *"Loss is visible"* lives here.
* **Chunk layer** (`doc_chunk`) — classified material is retrievable. *"Usable"* lives here.

Storing unclassified content in `doc_chunk` puts the source layer's guarantee in the chunk
layer, where it does not belong — and it would not even be reusable, since a future
prose-handling method would re-split a 3,000-word `Solution` section by paragraph, leaving
section-level rows stored now unused.

**Consequence worth noting**: with `sourceOffset`/`sourceLength` stored (previous entry), how
much of a file remains unclaimed is computable from the database alone — file length from the
manifest, minus the sum of claimed spans. Storing the unclaimed text is not needed in order to
know how much of it there is.
**Status**: active

## 2026-08-09 — Heading classification: an LLM authors a committed mapping table, and is not part of the pipeline

**Decision**: replace the hardcoded `kind` regex list with a committed `heading → kind`
mapping table. The table is authored with LLM assistance over the corpus's distinct heading
set, reviewed by a human, and committed. Ingest reads the table and makes no LLM call. Each
row records its origin (`regex | llm | manual`), matching `kind_confidence`, so an LLM-derived
subset can be re-reviewed later without a full re-run; manual entries take precedence over
generated ones.

**Why**: extending the regex list was heading toward a hand-maintained synonym dictionary.
`Drawbacks` is plainly a `cost` synonym the current rules miss, and every new source brings
its own vocabulary — precisely the "endlessly adapting non-LLM methods to every document type"
trap this project decided not to enter. Frequency offers no shortcut either: a one-occurrence
heading turned out to be `Drawbacks` while a 43-occurrence one is `Solution`, so no count-based
rule separates signal from noise.

An LLM is the right tool for *semantic classification* and the wrong tool for *boundaries*.
Boundaries must be reproducible because verbatim verification depends on them, and a drifting
boundary fails silently (DESIGN.md §7.6); a wrong label is caught by spot-checking twenty rows.
So rules decide where text is cut, an LLM decides what the resulting section is called, and
that decision is frozen into a reviewed file rather than recomputed per run. This keeps the
"human occupies the admission slot, never the data-entry slot" shape of DESIGN.md §9① — the
same pattern already used for concept candidates.

**Scope**: because the artifact is a static committed file, how it is authored is not
architecturally constrained and no tool needs to exist yet. If a classifier script is later
added under `corpus/tools/`, it would open a second LLM call site and would need reconciling
with Principle IV and DESIGN.md §4.5's "all LLM calls converge on a single `llm.py`" —
deliberately deferred, since the current approach creates no such call site.
**Status**: active

## 2026-08-09 — The `Item` model, settled by three hand-run generation experiments

**Decision**: DESIGN.md §13's open decisions #4 and #5 — which it marks as blocking all of P0
— are settled by experiment rather than on paper. Three generations were run against real
chunks from the ingested corpus, with a deliberately under-specified output schema so that
whatever the model reached for would be visible. The resulting `Item` shape:

```
scenario                      form layer, freely constructed
question                      the prompt the candidate sees
options[]
  benefit / cost / when_to_choose
    text                      paraphrase
    verbatim                  character-for-character source excerpt
    chunk_id
    strength                  direct | weak | null
answer_key                    form layer, no verbatim required
  preferred_option
  reasoning
gaps[]                        { option, field, reason }
```

`answer_key` is new, and belongs to the **form layer**. DESIGN.md §4.4 already presupposes a
correct answer exists — "the numbers you construct must support the reasoning behind the
correct answer" — but gave it no field, so the model invented one in all three runs and filled
it with unsourced assertions that no constraint applied to. Classifying it as form layer is the
honest resolution: the scenario is constructed, so which option wins *within that constructed
scenario* is equally constructed. It must be visibly marked as such in any interface, because
the sourced and constructed parts of an answer have to stay distinguishable to a reader —
especially once a follow-up conversation extends beyond the sourced material.

**Wording that must not be misread**: benefit, cost and when_to_choose are each independently
*verifiable* claims, but they are **generated together and verified separately**. Generating
them separately would violate DESIGN.md §12 #5 — the three must be mutually self-consistent,
and splitting the generation manufactures contradictions.

**Why — what the experiments showed**

*Grounding holds.* Across the three runs, 15 of 15 non-null citations verified mechanically:
every cited `chunk_id` exists, and every `verbatim` is a literal substring of the chunk it
cites. Zero fabrications.

*The "leave it null" rule fires.* Three fields had genuinely zero material — both `benefit`
fields in the throttling / queue-based-load-leveling run, and `when_to_choose` for
microservices. All three came back null with a `gaps` entry stating why. In the first of those
runs that meant a third of the answer key was left deliberately empty, and the model still did
not force a fit or fall back on its own knowledge. This is the guarantee the product rests on
and it had never been exercised: the first experiment had 37 chunks available and filled every
field, so the rule was never reached.

*The schema has to be pinned.* Left under-specified, the same need produced three different
shapes across three runs: `recommended_option` plus `decision_rationale`; then
`answer_key { preferred_option, reasoning }`; then nothing at all, with `question` omitted too.
Nothing downstream can consume that.
**Status**: active

## 2026-08-09 — `combine` must assemble mutually exclusive options; `related` edges do not

**Decision**: the `combine` step (DESIGN.md §4.2 ③) cannot use a concept's `related` edges to
assemble the options of a decision question. It needs a separate notion of "alternative to",
distinct from "related to". How that gets represented is not yet decided.

**Why**: `related` is populated from links the source documents make to one another, which
records that two concepts are *mentioned together* — not that either substitutes for the
other. Walking those edges from `cqrs` yields `event-sourcing`, and the two are complementary,
routinely used together. The generation experiment on that pair produced a question whose own
answer key observed that "CQRS could subsequently be combined with it" — the model noticed it
was not actually being asked to choose. Both options' costs also reduced to eventual
consistency, leaving no tension to reason about.

The contrast is sharp: the same prompt over `microservices` vs `n-tier` — genuinely mutually
exclusive architecture styles — produced real tension, with a six-person team, a four-month
migration deadline, and one subsystem expecting disproportionate traffic pulling migration cost
and targeted scalability in opposite directions.

**Observation to carry forward**: the six architecture-style documents are mutually exclusive
by nature, and are also among the few concepts with complete benefit/cost/when material. They
are the natural source of the first genuinely good questions, independently of how "alternative
to" is eventually modelled.
**Status**: active

## 2026-08-09 — The question is the scarce artifact; the cold reader becomes a core metric

**Decision**: the system's centre of value is *question generation*, not answer generation. The
sourced answer key is provided as completely as the corpus allows, and a follow-up conversation
may go beyond it — consulting the index first, then answering freely when the index holds
nothing. Free-form answers must be visually distinct from sourced ones, and are excluded from
answer records and diagnostics.

Consequently the "cold reader" (DESIGN.md §6, currently P3) is promoted from optional
experiment to core evaluation metric: generate an answer with no retrieved material and compare
it against the grounded version. If they are materially the same, retrieval added nothing for
that question — and the question was not worth generating.

**Why**: a general model already answers most interview questions competently. The asymmetry is
not capability but *verifiability*. A learner can defend themselves against a wrong answer —
cross-check it, ask a follow-up, look it up. They cannot defend themselves against a wrong
*question*, because the question is what defines what they believe they should know. Grounding
therefore belongs on the question side, and that is exactly what the corpus investment buys.

This also reorders evaluation priorities. DESIGN.md's evaluation focus is answer-side
(citation correctness, entailment). Under this positioning what needs measuring is the
question's own worth — does it encode a real tradeoff, and does retrieval measurably improve it
— and the cold reader is the instrument for that.

**Guard rail**: DESIGN.md §0 explicitly warns against restating the positioning as "this is just
a learning tool", and against dropping the data-model fields that support competence assessment
(observable difficulty dimensions, question versioning, full answer context). Framing the
question as an entry point to learning must not become a licence to drop those.
**Status**: active

## 2026-08-10 — The `kind` subsystem is abolished; every section is stored

**Decision**: remove heading-based `kind` classification entirely — the `ChunkKind` enum, the
`KindConfidence` enum, the regex list in `corpus/tools/chunk_azure.py`, the planned committed
`heading → kind` mapping table, and the discard/retain triage of unmapped headings. Every
section of every admitted document is chunked and stored. Nothing is filtered at ingest on the
basis of what its heading is called.

**Supersedes**:

* *2026-08-09 — Unclassified sections are not stored* — fully. Unclassified sections are now
  stored, because the category "unclassified" no longer exists.
* *2026-08-09 — Heading classification: an LLM authors a committed mapping table* — fully. The
  mapping table was a better way to do classification; classification itself is what is
  removed, so no table is authored and no second LLM call site is opened.
* *2026-08-08 — Chunk to H3, not just H2* — partially. Chunking on both `##` and `###` with
  code fences protected stands. The `kind` regex classification and the restriction of
  item-level splitting to cost/benefit/when sections do not.
* *2026-08-09 — `doc_chunk` granularity is a frozen contract* — partially. Granularity as a
  fixed contract that new sources adapt to stands, as do `sourceOffset`/`sourceLength`. "One
  chunk per *classified* section" does not.

**Why**: the filter was measured against the full Azure corpus and discards more than it keeps.

```
Full body text                  765,276 chars
  kept by the kind filter       206,217   (27%)
  dropped by the kind filter    529,808   (69%)
  headingless preamble           29,251   ( 4%)   — see the next entry

Largest single discards:  Solution 119,588 · Example 114,142
                          Workload design 71,531 · Context and problem 51,781
```

Volume alone would not settle it. What settles it is that the discarded text contains the
material the pipeline then reports as missing. Experiment 5 re-ran Experiment 2 — same two
concepts (`throttling`, `queue-based-load-leveling`), same prompt, one variable changed: all 18
sections of both documents supplied as `headingPath + content`, with no `kind` label and no hint
that anything was absent. Experiment 2 had declared benefit gaps for both concepts and was
recorded as evidence that the leave-it-null rule worked. Experiment 5 returned `gaps: []`, filled
both benefits, and all six verbatim excerpts verified against the source.

The benefit statements were in the `Solution` sections both times — a heading the regex list does
not recognise, so the text never reached the model. Experiment 2's "correct" gap detection was an
artifact of Experiment 2's own filter. This also corrects the claim recorded in *2026-08-09 — The
`Item` model* that three fields had genuinely zero supporting material; two of those three did
have material, hidden by the filter.

The failure mode generalises past this one filter: **anything that decides what the model may see
before the model sees it can manufacture a false absence, and does so without raising an error.**
The pipeline cannot distinguish "the corpus lacks this" from "we hid it," and `gaps` — a
first-class corpus-growth signal per the 2026-08-08 entry — is exactly the output that gets
corrupted.

`kind` is not preserved as a display label either. `headingPath`'s last element ("Problems and
considerations") carries more information than the enum value (`cost`) it would replace, so the
enum is subsumed rather than sacrificed.
**Status**: active

## 2026-08-10 — Headingless preamble text was never ingested at all

**Decision**: chunking must cover the text before a document's first `##`/`###` heading. It
becomes a chunk whose `headingPath` is the document title alone.

**Why**: measured across the 49 Azure pattern documents, **49 of 49** have text between the H1 and
the first H2, totalling 29,251 characters. The chunker iterates over heading matches, so this text
never entered the loop — and because the unmapped-headings report is keyed on headings, text with
no heading did not appear there either. It was invisible to both the pipeline and its own
loss-reporting.

This is a stricter failure than the `kind` filter. That filter dropped text but recorded the
heading it dropped; this dropped text and recorded nothing. The three-layer guarantee from
*2026-08-09 — Unclassified sections are not stored* claimed "loss is visible" lives in the report
layer, and for this text it did not.

The preambles are also not incidental — they hold the concept definitions. `cqrs`'s begins
"Segregate the read and write operations for a data store into separate data models…", which is
the single most useful sentence in the document for the concept-index product below.
**Status**: active

## 2026-08-10 — Structure-first, size-bounded hierarchical chunking

**Decision**: the chunking contract becomes:

1. Split on document structure — H1 title, then `##`/`###` sections, code fences protected.
   Preamble text is a section under the title alone.
2. Each chunk carries `headingPath` (`["CQRS", "Solution", "Benefits of CQRS"]`), replacing both
   `label` and `contextPrefix`.
3. A section whose body exceeds the size cap splits into child chunks — on bullet items where the
   body is a list, otherwise recursively at paragraph boundaries. Children carry `parentChunkId`;
   parents carry `null`.
4. Size bounds are enforced as a cap and a floor, both with recorded rationale (next entry).
5. `headingPath` is prepended to the text sent to the embedding model. It is **not** concatenated
   into the stored `content` column.

**Why**: point 5 is the one most likely to be "optimised" away later, so the reason is recorded
here. A chunk embedded on its own body alone loses its anchor — the bullet "Message queues are a
one-way communication mechanism" embeds as a generic fact about message queues, not as a cost of
Queue-Based Load Leveling. Prepending the heading path pulls the vector back to the concept it
belongs to. It is a deterministic, zero-cost version of what Contextual Retrieval spends an LLM
call per chunk to produce; for structured documents the heading path already carries most of that
information. This is worth re-evaluating only for prose sources with no reliable heading
structure.

Keeping the prefix out of `content` is equally deliberate: SCRUM-42 shipped a bug where the
contextual prefix was concatenated into `content`, which breaks `content.includes(verbatim)`
against the true source text.

**Cost**: ~425 chunks / 347 KB today becomes an estimated ~600 chunks / 710 KB — a 2x increase on
a base small enough that it does not matter. Storage is not a constraint at this scale; embeddings
are what grow (see two entries down).
**Status**: active

## 2026-08-10 — The size cap exists to prevent dilution, the floor to prevent loss of anchoring

**Decision**: record the reasons for both bounds, because a size limit with no recorded rationale
gets treated as an arbitrary number and tuned away.

**Cap — semantic dilution.** An embedding model returns exactly one vector per input, regardless
of input length: per-token vectors exist inside the network but are pooled into a single output.
A chunk covering three topics therefore produces one point that is near none of them, and it will
not be retrieved by a query about any of them.

**Explicitly not the reason**: the model's own limit. `text-embedding-3-small` accepts 8,191
tokens ≈ 32,000 characters; the largest section in the corpus is roughly 5,000 characters. Citing
the model limit as the justification would be checkable and false, and would invite removing the
bound.

**Floor — loss of anchoring.** Below some size a fragment stops carrying enough context for its
vector to mean anything. `headingPath` prefixing (previous entry) mitigates this, which is why the
floor can be set lower than it otherwise could.

**Secondary, real**: citation granularity. A large chunk makes `verbatim` point into a large blob,
so the cold reader has to hunt for the sentence, and the entailment check gets a larger haystack.
**Status**: active

## 2026-08-10 — The concept point cloud is the first product surface; question generation is deferred, not dropped

**Decision**: the first thing built on the corpus is a navigable concept map, not question
generation. Given a JD, render the concept graph with per-concept relevance shown as node colour,
concepts the corpus knows but has no material for shown as grey nodes, and drill-down in two
directions: into a concept's source sections, and outward to its related concepts. Question
generation, the `Item` model, entailment verification and the fact/form layer split are unchanged
and remain the intended direction — they are sequenced later, and the data model must not
foreclose them.

**Why**: the point cloud ships on what already exists (49 concepts, 43 of them with `related`
edges, 425 chunks) and needs none of generation quality, answer keys or entailment checking. More
importantly it makes corpus coverage the product's visible surface rather than a hidden failure.
Experiment 4 fed four real AI-engineering JDs through extraction and matched **0 of 93** extracted
items against the 49 Azure architecture concepts. As a question generator that is an embarrassing
empty result; as a concept map it is the correct output — a sparse, mostly grey cloud truthfully
reporting that this corpus does not cover these roles. That is DESIGN.md §7.8's stated goal
("know what isn't covered") made visible.

**Measured graph structure** (49 concepts):

```
72 undirected edges, mean degree 2.9      sparse enough to lay out legibly
one 42-node component + 7 isolates
83 directed pairs: 22 mutual, 61 one-way  `related` reflects what each document linked to,
                                          not a mutual relationship
34 dangling references to 20 concepts     e.g. messaging, caching, ci-cd,
                                          high-performance-computing
```

Three consequences:

* The 20 dangling targets become `Concept` rows with `status = candidate` and
  `hasCorpus = false` — the "known but no material yet" state the two-table model was designed
  for (2026-08-08). They render as grey nodes, and connecting them rescues 3 of the 7 isolates
  (`big-compute`, `cache-aside`, `big-data`). The remaining 4 have no `related` entries at all.
* Edge strength does not exist in the data — `related` is a boolean string array. Mutual versus
  one-way is a free, weak signal available now; concept-to-concept embedding similarity is the
  richer one.
* No taxonomy is built. The "parent node" in the mock-up is whichever node currently has focus,
  as in a focus-plus-context local graph. An intrinsic hierarchy (style → pattern → variant)
  would be new hand-curated data and falls under hard constraint 7.

**Blocking gap**: `concept.aliases` is empty for all 49 rows. It was previously "resolve's first
tier misses"; as the product's entry point it is now the accuracy floor — a JD saying "message
queue" has to reach `queue-based-load-leveling`.
**Status**: active

## 2026-08-10 — Embedding is concept-level only; the chunk-level column is built but left unfilled

**Decision**: compute and store embeddings for `Concept` rows (~49 admitted + ~20 candidate ≈ 70
vectors). Add `embedding vector(1536)` to `DocChunk` in the same migration but populate no values.
Retrieval of a concept's chunks stays an exhaustive `pattern_id` lookup returning every chunk in
document order.

This amends rather than supersedes *2026-08-08 — Vector search only at `resolve`, never at
`retrieve`*: `retrieve` still has no vector component, but concept-level vectors now serve three
uses instead of one.

```
1. JD item → concept relevance      node colour in the point cloud
2. concept → concept similarity     edge strength / layout distance
3. neighbours for isolated nodes    the 4 concepts with no `related` entries
```

All three are concept-level. 70 vectors is roughly 4,900 pairwise comparisons — computed per
request, not stored.

**Why no chunk-level values**: retrieval is compression, and there is nothing to compress. A
concept's entire material averages ~14,800 characters ≈ 3,700 tokens against a generation budget
above 128,000. Experiment 5 supplied everything for two concepts and it worked. Beyond being
unnecessary, top-k chunk retrieval is structurally the same operation as the `kind` filter
abolished above — it decides what the model may see before the model sees it, returns k results
regardless of whether any are relevant, and fails silently.

**Trigger for chunk-level retrieval**: a single concept's total chunk text exceeds the generation
context budget, or full-material cost becomes unacceptable. Note that the driver is *sources per
concept*, not corpus size — one document about CQRS stays one document's length no matter how many
unrelated sources are added; what grows is the same concept being covered by several sources.

**Two conditions must be met before it is enabled**: an evaluation instrument capable of detecting
"material that should have been supplied was not" (without it, the Experiment 2 failure mode is
reinstalled and undetectable), and a threshold calibrated against positive/negative baselines per
DESIGN.md §8. The small-to-big pattern that `parentChunkId` enables is deferred to the same
trigger.
**Status**: active

## 2026-08-10 — Reversibility decides what must be settled now

**Decision**: at this stage, settle only decisions that are expensive to reverse. Everything else
is deliberately left as a nullable column, an unpopulated value, or an absent table.

```
Expensive   concept_id                      already a hard constraint (2026-08-08)
Expensive   chunk_id scheme + granularity   the target of every verbatim citation and,
                                            later, of answer records
Cheap       adding a nullable column        additive migration
Cheap       computing embeddings            ~70 vectors in seconds
Cheap       edge weights                    computed per request, never stored
```

**Why**: the raw corpus is committed under `corpus/raw/` with a per-file sha256 in
`corpus/_meta/manifest/`, so re-ingest is always available and "not stored in the database" never
means "lost". That safety net does not extend to identifiers, because changing an id breaks
references held outside the ingest pipeline — foreign keys today, stored citations and answer
records later. Identifiers are therefore the only category that must be right the first time.

**Deferred on this basis, with no cost to deferring**: chunk-level embedding *values*, the `Item`
model and answer-record tables, a materialised concept-edge-weight table, persistence of JD
analysis results, and any intrinsic concept taxonomy. Each is purely additive and touches no
existing identifier.

## 2026-08-10 — `concept_terms` replaces `Concept.aliases`; tier-1 resolution is unique by construction

**Decision**: drop `Concept.aliases String[]` and add a `ConceptTerm` table. Every string that can
identify a concept — its `conceptId`, its `name`, and each authored alias — becomes one row in a
single column, and that column is the primary key.

```prisma
enum TermType { id name alias }

model ConceptTerm {
  term        String   @id                    // normalized
  displayTerm String   @map("display_term")   // as authored, for display and audit
  conceptId   String   @map("concept_id")
  termType    TermType @map("term_type")

  concept Concept @relation(fields: [conceptId], references: [conceptId], onDelete: Cascade)

  @@index([conceptId])
  @@map("concept_terms")
}
```

Tier-1 resolution becomes `SELECT concept_id FROM concept_terms WHERE term = $1` — one primary-key
lookup, no array scan, no `ANY()`.

**Why a table rather than a validated array**: the rule "an alias may not equal any concept's id or
name" is a cross-row constraint, and Postgres `CHECK` cannot express one. Written as application
logic it is a step someone can forget, skip, or regress. Written as a primary key over a shared
namespace it cannot be violated at all — an alias colliding with another concept's name is simply
a duplicate key, and ingest fails.

**Consequences that must be implemented deliberately**:

* **Normalization has exactly one implementation.** `normalizeTerm()` — lowercase, collapse
  non-alphanumerics to single spaces, trim — is used both when writing terms and when querying
  them. Two implementations that drift produce lookups that silently return nothing. Both call
  sites are TypeScript (ingest and resolve), so this is one function in one place; it is a
  concrete reason resolve stays on the NestJS side of the boundary.
* **Within a concept, collisions are silently deduplicated; across concepts they are fatal.**
  Almost every concept's id and name normalize to the same term (`cqrs` / `CQRS`,
  `circuit-breaker` / `Circuit Breaker`), so intra-concept collision is the normal case, not an
  error. Precedence is `id` > `name` > `alias`.
* **Ingest reports all collisions before failing**, rather than stopping at the first.
* **The rule is enforced across the whole authored file, not against existing database state.**
  Ingest is idempotent and rebuilds `concept_terms` from `candidates/*.jsonl` on every run, so
  collision detection must not depend on insertion order or on rows left over from a previous run.
* A Jest test asserts term uniqueness over the candidate files directly, giving feedback without a
  database. The primary key remains the backstop: a test can be skipped or deleted, a constraint
  cannot.

**Reversibility**: `term` is a derived value with no external references, so a change to
normalization simply regenerates the table. This is why it can be a primary key while
`concept_id` and `chunk_id` are frozen — see the reversibility entry above.
**Status**: active

## 2026-08-10 — Tier 1 resolves to exactly one concept; ambiguity belongs to tier 2

**Decision**: an alias maps to exactly one concept. Where a phrase genuinely refers to more than
one concept, the additional concepts are surfaced by tier-2 vector similarity and by `related`
edges, not by multi-mapping the alias.

**Why**: this was briefly considered the other way — letting one alias light up several nodes in
the point cloud looked like the more informative behaviour. It is the wrong layer. DESIGN.md §8's
principle is that ambiguity should be concentrated where it can be reasoned about; tier 1 exists
precisely to be exact and deterministic, and making it multi-valued removes the one place in
resolve that cannot be wrong.

**Worked example, measured rather than assumed**. `throttling` and `rate-limiting` are separate
concepts in the corpus, and checking their definitions showed they are not duplicates — they are
opposite sides of one interaction:

```
Throttling     server side.  "Limit the resources that an application instance, an
                              individual tenant, or an entire service can consume."
Rate Limiting  client side.  "Control the rate at which your application sends requests
                              to a service so that you stay within the service's
                              throttling limits"
```

The `rate-limiting` document links to `throttling` inside its own definition, and the two are
already joined by a `related` edge.

Colloquially, though, "rate limiting" usually means what Azure calls Throttling. So a JD saying
"implement rate limiting on our API" will match `rate-limiting` exactly, at tier 1, with no vector
call and no threshold — and be wrong. **An exact match that is confidently wrong is worse than a
miss**, because a miss falls through to the later tiers and this does not.

Two things follow:

1. The primary-key constraint is doing more than preventing duplicates. It prevents a real
   ambiguity from being *hidden* — allowing "rate limiting" as an alias of `throttling` would
   erase the distinction from the data, where no one would ever see it again. Failing at ingest
   forces the ambiguity to be confronted.
2. This is a further argument for sequencing the point cloud ahead of question generation. Question
   generation must pick one concept and a wrong pick silently corrupts the question. The point
   cloud does not pick: tier 1 lights `rate-limiting`, tier 2 and the `related` edge light
   `throttling`, and the user reads both and learns the distinction. The ambiguity becomes
   information instead of an error.

**Authoring consequence**: alias drafting must receive each concept's definition sentence and its
`related` ids, not just its name. Given names alone, "rate limiting" as an alias of `throttling` is
the answer any model — or person — would give.
**Status**: active

## 2026-08-10 — `chunk_id` scheme: heading path for sections, content hash for sub-splits

**Decision**: with `kind` removed from the identifier, the scheme becomes

```
section chunk   {source}:{concept}:{heading-path-slug}
                azure:cqrs:solution--benefits-of-cqrs

split child     {source}:{concept}:{heading-path-slug}:{content-sha8}
                azure:cqrs:solution--benefits-of-cqrs:a3f21b09
```

The existing numeric disambiguation suffix for duplicate slugs within a concept is retained.
Every current `chunk_id` changes as a result. That is acceptable exactly once — nothing outside
the ingest pipeline references them yet — and this is the last time it may happen.

**Why the child uses a content hash rather than an ordinal**: `specs/005` FR-005 already required
ids to be label-derived rather than positional. A section split at paragraph boundaries has no
label to derive from, leaving two options:

```
ordinal   text is inserted upstream, every later child shifts
          → the id survives but now denotes different text     → silent error
hash      the text changes, the id changes
          → the citation breaks visibly                        → explicit error
```

An id that stays stable while the text under it changes is worse than an id that breaks, because
a stored citation or answer record would keep pointing at it and quietly mean something else. The
same reasoning runs through hard constraints 1, 3 and 6.

Sections keep a heading-derived id because a heading is a stable, meaningful anchor in the
document's structure; sub-splits have no such anchor and fall back to their own content. Each
level uses the most stable identifier available to it.
**Status**: active

## 2026-08-10 — Terms are extracted mechanically; hand-authored aliases are deferred until measured

**Decision**: `concept_terms` is populated entirely by rule at ingest, with no hand annotation:

```
conceptId                       throttling
name                            Throttling
H1 / frontmatter title          Throttling pattern
name with/without the "pattern" suffix
```

Hand-authored aliases are removed from the near-term plan. They are added later, only for
categories that a measurement shows tier-2 vector resolution actually fails on.

**Supersedes** the "Blocking gap" paragraph of *2026-08-10 — The concept point cloud is the first
product surface*, which called empty `aliases` "the accuracy floor". That was overstated. The
system resolves without any aliases at all — a term-table miss simply falls through to vector
similarity. Aliases are an optimisation that converts a probabilistic match into a deterministic
one; they are not a prerequisite.

**Why**: the plan had reached "hand-write roughly 200 aliases" without anyone testing whether
vector-only resolution is adequate. That is the same mistake as the abolished heading mapping
table — reaching for per-vocabulary manual annotation before establishing that the automatic path
is insufficient — and it contradicts the measurement-first discipline recorded on 2026-08-08.

**The measurement that gates the work**: run real JD items through vector-only resolve and record
not just the hit rate but *which category* fails. The expectation is that ordinary phrases resolve
("request throttling" → `throttling`) and short acronyms do not ("BFF"), which would make the
residual roughly a dozen concepts rather than two hundred.

**Also corrected**: the normalization in the `concept_terms` entry above was specified as
"collapse non-alphanumerics to single spaces". It is now **strip all non-alphanumerics**:

```ts
export function normalizeTerm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
```

Measured over the 49 concepts, both variants produce 50 terms and zero collisions, but stripping
also unifies concatenated and separated spellings (`anti-corruption-layer` and
`anticorruption layer` both become `anticorruptionlayer`), which removes an entire class of
variant that would otherwise have to be hand-written. `displayTerm` carries the readable form, so
the key does not need to be legible. The uniqueness test will catch any collision this creates as
the concept set grows.
**Status**: active

## 2026-08-10 — Embedding dimension is 1536, and the deciding factor is not concept count

**Decision**: `vector(1536)`, `text-embedding-3-small`, as DESIGN.md §8 already specified.

**Why not sized to the corpus**: at this scale, dimension is not a cost variable at all.

```
300 concepts x 1536 dims x 4 bytes = 1.8 MB      one query = 460k multiply-adds, microseconds
300 concepts x  256 dims x 4 bytes = 0.3 MB
```

Reducing dimensions saves nothing that matters and only begins to pay off at millions of vectors.
What dimension actually buys is resolution between *near* items, and this corpus's hard cases are
exactly that — `throttling` versus `rate-limiting` is a fine distinction, and fine distinctions are
the first thing lost when a Matryoshka embedding is truncated. Truncating would trade away the only
property worth having in exchange for a saving of no consequence.

**Why not `text-embedding-3-large` (3072)**: better on near-synonyms, negligible extra storage, but
roughly 6.5x the per-token price — and JD items are embedded live on every request, so that cost is
recurring while the benefit is unverified.

**Reconsideration trigger, available in the same step that computes the vectors**: threshold
calibration produces positive and negative baseline distributions. If they overlap heavily, 1536 is
not separating this concept set and `large` is worth trying; if they separate cleanly, the question
is closed. Switching costs one migration plus a few seconds of recomputation for ~70 vectors, so
this is a revisable default rather than a lock-in.
**Status**: active

## 2026-08-10 — Run the loop end to end before expanding the corpus

**Decision**: no further corpus expansion until a JD produces a rendered concept map. The queued
items — adding `docs/ai-ml/` and `docs/antipatterns/`, growing toward 300 concepts, hand-authored
aliases — all wait behind that.

**Why**: DESIGN.md §11 sizes P0 at two to three weeks covering *both* halves, offline and online.
All work so far has been offline, and the online half has never run once. DESIGN.md §11 names this
exact failure mode — weeks of corpus work without ever running the pipeline — and the point-cloud
re-sequencing pushes the online half further out again.

The risk is not that the architecture is wrong. It is ending up with well-engineered plumbing and
nothing running, which is also the only state in which the obvious challenge to this project —
"why not paste the job description into a general model with web search and let it write the
notes?" — becomes unanswerable. That challenge is largely correct on product grounds and DESIGN.md
§0 does not contest it: product usability is explicitly secondary to learning AI engineering and
having something demonstrable. What makes the project defensible is having run it and found things
the shortcut cannot surface, such as the 69% loss measured above. That defence requires a working
loop, not a larger corpus.

**The shortest path to it**, using only what exists: 49 concepts, 43 with `related` edges, 425
chunks, plus mechanically-extracted terms, ~70 concept vectors, extract, resolve, and a graph view.
No generation, no verification, no answer records, no manual annotation.
**Status**: active

## 2026-08-10 — Correction: the raw corpus is re-fetchable, not committed; the concept seed is now tracked

**Corrects** *2026-08-10 — Reversibility decides what must be settled now*, which stated that
"the raw corpus is committed under `corpus/raw/`". It is not. `corpus/raw/` is gitignored and
is 502 MB.

**What the safety net actually is**: `corpus/sources.yaml` pins each source to an upstream
commit, and `corpus/_meta/manifest/*.jsonl` records a sha256 per file. Recovery is therefore
*re-fetch and verify*, not *read from disk*. The guarantee still holds — the same bytes are
recoverable and provably the same — but it depends on the upstream repository still serving
that commit, which committed files would not.

The reversibility argument itself is unaffected: identifiers remain the only category that
must be right the first time, because everything else can be rebuilt from the source layer
one way or another.

**Separately fixed**: `corpus/_meta/candidates/azure.jsonl` had never been committed at all. It
held the 49 human-accepted concepts and existed only inside one worktree. It is now tracked,
with the gitignore comment amended to say why it is exempt from the "re-derivable" rule that
covers the discovery logs and caches beside it — a concept admitted by a person under hard
constraint 7 is a decision, not derived data, and `concept_id` may never be renamed once it
exists.
## 2026-08-10 — Embedding calls belong to the inference service; storing and comparing vectors does not

**Decision**: the call that turns text into a vector is made by the Python agent orchestration
service, exposed over the existing HTTP interface. The corpus build and, later, `resolve` obtain
vectors by asking for them. Storing vectors and computing similarity between them stay with the
NestJS service as ordinary database work. The agent service never stores a vector, never reads
one, and never performs a similarity search — consistent with DESIGN.md §4.1's rule that Python
does not connect to the database.

This settles the question the *heading classification* entry deferred on 2026-08-09 when it
declined to open a second model call site, and which the abolition of that mapping table left
open rather than answered.

**Why, in order of weight**:

1. **Credential handling would otherwise be duplicated.** `agent_service/secrets.py` fetches the
   provider key from AWS Secrets Manager; the TypeScript side has no secret-handling code at
   all. Putting the call there means writing that a second time — and the pending migration from
   a long-lived access key to a role-based credential would then have to be done twice, in two
   languages.
2. **It matches the recorded split** — DESIGN.md §4.1 gives inference to Python and persistence
   plus retrieval to TypeScript. An embedding call is inference; a vector comparison in the
   database is retrieval. The boundary already answers this; it had simply not been applied to
   embeddings.
3. **It adds no dependency.** One endpoint on the agent service, one method on the existing
   `agent-orchestration.client.ts`. The alternative needs an AWS SDK client that is not declared
   and a provider client that is.

**What was weighed and found not to matter**: the extra local HTTP hop costs single-digit
milliseconds against a provider call of 50–200ms. Availability coupling is not new either — the
NestJS service already depends on the agent service for extraction.

**Discovered while deciding, and corrected as part of this feature**: `package.json` declares
`openai` and `@langchain/langgraph` as dependencies of the NestJS service, and neither is
imported anywhere. They are residue from before SCRUM-41 moved model calls to Python. Under this
decision the first must not exist on that side at all and the second belongs to the agent
service, so both are removed. A declared dependency is a statement about what a service does;
these two currently state the opposite of the boundary.
**Status**: active
