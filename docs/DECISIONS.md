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

## 2026-08-11 — Implementation decisions settled while building SCRUM-44, not fixed by the spec

**Decision**: five judgment calls came up executing `specs/006-corpus-structure-rebuild`'s tasks
that the spec, plan, and data-model left open. Recorded here per that feature's own instruction
to append anything decided during implementation that wasn't already settled.

1. **Chunk content is never trimmed of surrounding whitespace.** A section's span runs from
   immediately after its heading line's newline through the start of the next heading line (or
   EOF), verbatim — no leading/trailing blank-line stripping. This makes the coverage invariant
   trivial to prove by construction: sections partition (post-frontmatter text minus heading-line
   bytes) exactly, with the "Full body text" denominator already established by the `kind`-filter
   measurement above. Trimming would have required deciding where the trimmed whitespace
   "belongs" for coverage-accounting purposes, for a purely cosmetic gain — a stray leading
   newline in a stored `content` field costs nothing a downstream consumer can't strip at display
   time, and the stored field itself stays exactly byte-reproducible.

2. **A preamble's `chunk_id` heading-path-slug is the literal reserved segment `preamble`.**
   `data-model.md`'s scheme (`{source}:{concept}:{heading-path-slug}`) has no example for a
   title-only `headingPath` (length 1, no segments below the title to slugify). `azure:cqrs:cqrs`
   was considered and rejected as confusing; `preamble` is unambiguous and — like any other
   heading-path-slug — still goes through the existing content-hash collision disambiguation if a
   document ever has a literal `## Preamble` heading of its own.

3. **Split-section parent rows ARE stored as full-span `doc_chunk` rows, and coverage is computed
   over leaf chunks only.** The self-referencing `parentChunkId` foreign key requires the parent
   row to exist, so a split section produces one parent row (full section span, `parentChunkId`
   null) plus N child rows (sub-spans). Counting both toward "coverage" would double-count claimed
   bytes for every split section. The invariant that matters is over the *leaves* of the
   parent/child tree — a chunk with no children, whether an unsplit section or a child of a split
   one — and that is what `test_real_corpus_overall_byte_coverage_is_total` and
   `test_real_corpus_leaf_chunks_reconstruct_every_document_exactly` both compute against.

4. **Directive-line stripping (`split_around_directives` / `strip_directives`, from
   `specs/005-corpus-ingest-foundation`) is removed, not carried forward.** The old chunker
   excised `:::image:::`-style directive lines from content and emitted separate chunks around
   the gap — under the old `kind`-classified, partial-coverage world this was harmless, but under
   this feature's "every byte accounted for" invariant it is a real, unrecoverable gap: the
   directive line's bytes belonged to no chunk at all. Directive markup is now stored verbatim as
   part of whatever chunk it falls inside, which costs nothing (it is inert text to any downstream
   consumer) and preserves exactness. The now-orphaned functions and their tests were deleted
   rather than left dead in the module.

5. **The candidate JSONL gains a `title` field** (`corpus/_meta/candidates/azure.jsonl`): the raw
   H1/frontmatter title, unstripped of a trailing "Pattern"/"Architecture Style" suffix — distinct
   from the already-existing `name` field, which has that suffix removed. `data-model.md`'s
   `ConceptTerm` population table names "H1 or frontmatter title" as a term source, but no field
   carrying that raw string existed anywhere before this feature; `chunk_azure.py` now captures it
   (frontmatter `title` first, falling back to the document's H1, searched only within the
   preamble so a `# ` line inside a later code sample is never mistaken for the title).

   **Corrects** the "124 terms over 49 concepts" figure `data-model.md` recorded as measured:
   that number predates the `title` field existing, so it could not have been measured against
   this implementation. The actual figure, measured after implementing: **105 terms over the 49
   admitted concepts** (2.14/concept), rising to **147 terms over all 70 concepts** (49 admitted +
   21 related-edge) once related-edge stubs are included. The gap from 124 is fully explained, not
   a defect: for the 43 non-architecture-style pattern documents, the raw title (e.g. "Ambassador
   Pattern") and the mechanically-derived "name + trailing pattern" variant (e.g. "Ambassador
   pattern") normalize identically, so they collapse to one `title`-type term under the existing
   precedence rule — 2 terms/concept for those 43, 3 for the 6 architecture-style documents (whose
   raw title, "X Architecture Style", does not collide with "X pattern"). `SC-003` (every phrase
   resolves to exactly one concept) holds regardless of the exact count: 0 cross-concept
   collisions, verified by `tests/unit/corpus/concept-terms.test.ts` against the real candidate
   file.
**Status**: active

## 2026-08-11 — Related-edge stub concepts default to `kind: domain`; embedding input is name + terms + a 500-character opening

**Decision**: two further judgment calls, both additive and easily revised:

1. A related-edge stub concept (no admitted material, id/name only) is created with
   `kind: ConceptKind.domain` — a generic default, since its real kind is genuinely unknown until
   material is admitted for it. `name` is derived the same way `chunk_azure.py`'s own
   no-frontmatter fallback already works (humanize the id: split on `-`, capitalize each word).
2. The text submitted for embedding (FR-019) is `name`, then `also known as: <comma-joined
   terms>` (its `concept_terms` entries, excluding the `id`-type one — a slug adds nothing a
   name-based embedding needs), then the first **500 characters** of its preamble chunk where
   material exists. 500 was chosen as "enough to carry the definition, not so much it dilutes
   toward the rest of the document" — no measurement was taken to tune this number, and it is
   cheap to change (recomputing ~70 vectors costs seconds, per the existing embedding-dimension
   entry's reversibility note).

**Why not deferred to a spec update**: both are additive, touch no identifier, and are exactly
the kind of "nullable column / nullable default" choice the 2026-08-10 "Reversibility decides
what must be settled now" entry says doesn't need to be settled in advance.
**Status**: active

## 2026-08-11 — Measured: the positive/negative similarity baselines overlap

**Decision**: record the measurement FR-022 exists to produce, without acting on it.

```
positive (related-edge pairs, n=107)     p10 = 0.30
negative (all other pairs, n=2,308)      p90 = 0.44
```

Measured twice — once against the real corpus after a normal ingest, once again after a full
`prisma migrate reset` and rebuild from zero — with consistent results (p10 0.3016–0.3017, p90
0.4419 both times; embeddings vary by a few thousandths of a percent run to run, consistent with
provider-side non-determinism, not a bug).

**What this means**: the positive baseline's 10th percentile sits *below* the negative baseline's
90th percentile. Per the 2026-08-10 "Embedding dimension is 1536" entry's own reconsideration
trigger — "if they overlap heavily, 1536 is not separating this concept set and `large` is worth
trying" — that trigger has now fired, on real data. This entry records the fact; it does not act
on it. Trying `text-embedding-3-large` is out of scope for SCRUM-44, which is about the corpus
build finishing and reporting the evidence (FR-022 says exactly this — "do not choose a
threshold here"), not about closing the loop that evidence opens. The next feature that resolves
a JD phrase against these vectors should read this entry first.
**Status**: active

## 2026-08-11 — Correction: the measured baselines do not calibrate resolve's threshold

**Supersedes the conclusion of** *2026-08-11 — Measured: the positive/negative similarity
baselines overlap*. The measurement itself stands and is not repudiated: related-edge pairs
p10 = 0.30 over n=107, all other pairs p90 = 0.44 over n=2,308, stable across two full rebuilds.
What does not follow is the inference drawn from it.

**What was measured versus what FR-022 asks for**:

```
DESIGN.md 8 specifies      positive = a concept's own aliases used as queries,
                            where the answer must be that same concept
                            negative = completely unrelated words
                            -> a query-to-concept distribution

what was implemented        positive = related-edge pairs between two *different* concepts
                            negative = every other concept pair
                            -> a concept-to-concept distribution
```

These are not the same relation. `related` edges join concepts a reader should be able to tell
apart — `cqrs` and `event-sourcing`, `throttling` and `rate-limiting`. If those pairs scored
*high*, that would be evidence `resolve` is likely to confuse them, not evidence the embedding
is healthy. Used as a positive baseline the sign is inverted.

The superseded entry therefore states that the 2026-08-10 dimension-reconsideration trigger
"has now fired, on real data". It has not. That trigger concerns whether the model separates a
query from a concept; nothing measured here bears on it, and no conclusion about
`text-embedding-3-small` versus `-large` is supported by this data either way.

**Why the specified calibration was not run**: it needs alias phrasings, and `concept_terms`
holds only mechanically derived entries — hand-authored aliases were deliberately deferred
until a measurement shows which category automatic resolution fails on. The specified positive
baseline is therefore not constructible yet. The correct record was "the specified calibration
cannot be run at this stage, and here is why", rather than substituting a different relation and
reporting its result against the original trigger.

**What the numbers do say**, stated without overreach: concepts joined by a `related` edge are
not reliably more similar, under this embedding, than concepts that are not. That is a fact
about the `related` graph's semantics — those edges record "the author linked these", not "these
mean nearly the same thing" — and it is mildly reassuring for the point cloud, where edge
strength and node relevance are meant to be independent signals.

**What must happen before a threshold is chosen**: build a query-side sample that does not come
from the same source as the concept records — real job-description phrasings are the
uncontaminated option already available, and Experiment 4's extracted items exist for this. Then
run DESIGN.md 8's calibration as written. Until then no threshold, and no model comparison,
rests on evidence.

**Process note**: the substitution was visible in the entry's own labels ("related-edge pairs",
"all other pairs") and still produced a wrong conclusion that was recorded as active and pointed
at the next feature. Naming what you measured is not sufficient; the check is whether the thing
measured is the thing the decision turns on.
**Status**: active

## 2026-08-11 — Correction: the corpus is not pinned, so re-fetching does not reproduce it

**Corrects** *2026-08-10 — Correction: the raw corpus is re-fetchable, not committed*, which
claimed "`corpus/sources.yaml` pins each source to an upstream commit". It does not. The same
claim appears in this feature's migration comment ("reproducible from the source layer,
re-fetched and verified against `corpus/_meta/manifest/`") and is wrong there too.

**Measured, not reasoned.** The `corpus-build` worktree was deleted, taking the only copy of
`corpus/raw/` with it, so the documented recovery path was exercised for real:

```
python corpus/tools/fetch_git.py --only azure

manifest commit_sha   a8c749f836cf...      what SCRUM-44 was built against
re-fetched commit     fbb66e47c92d         whatever HEAD happened to be

against the 58 manifest entries:   40 identical
                                   17 changed
                                    1 gone     (priority-queue-content.md)
                                    1 added    (59 files now, 50 concept-eligible)
```

**Why**: `sources.yaml` carries `repo` and `paths` and no commit field, and `fetch_git.py` always
runs `git clone --depth 1` against the default branch, then records the HEAD it landed on as
`commit_sha`. Its own log line says "pinned commit {sha}", which reads as though it pinned
something; it recorded, it did not pin.

**What the manifest is actually good for**: detection, not recovery. The recorded `commit_sha`
and per-file `sha256` make drift *visible* — that is how the 17/1/1 above was established at all,
and it is worth keeping. What they cannot do is return the original bytes.

**What this affects**:

- The safety argument for `TRUNCATE doc_chunks` is weaker than the migration comment states. The
  table can be rebuilt, but from *current* upstream, not from the state it was built against.
- Verbatim citations are the real exposure. A `verbatim` recorded against a file that upstream
  has since edited will no longer be found in the re-fetched text, and hard constraint 3's
  entailment check cannot recover from a substring that has vanished. Nothing depends on this
  yet — no citations are stored — but the question-generation feature cannot land on an unpinned
  corpus without accepting silent citation rot.
- SCRUM-44's reported figures (49 concepts, 490 sections, 607 rows) describe a corpus state that
  no longer exists locally and cannot be restored. The current tree measures 50 concepts. The
  assertions are invariants and still hold, which is why the suite passes either way; the
  headline counts are snapshots and should be read as such.

**Not fixed here.** Pinning is a change to `sources.yaml` plus commit-aware fetching in
`fetch_git.py`, across 20 sources, and it does not belong in a PR about chunking. Recorded as the
next corpus-layer piece of work, ahead of anything that stores a citation.

## 2026-08-21 — The raw corpus moves outside the working tree, and every git source is pinned

**Decision**: two changes to the corpus layer, both prompted by losing the corpus for real.

1. `corpus/tools/corpus_paths.py` resolves the raw root from `JOBPILOT_CORPUS_RAW`, falling
   back to `corpus/raw/`. Every tool imports it. Manifest `local_path` values stay written as
   `raw/<source>/...` no matter where the tree physically lives, so manifests remain portable and
   no existing record needed rewriting.
2. All 15 git sources in `corpus/sources.yaml` carry a `commit:` taken from the manifest's
   recorded `commit_sha`, and `fetch_git.py` fetches that commit rather than the default branch.
   It refuses to continue if the checked-out sha differs from the pin.

**What happened**: the `corpus-build` worktree was removed at 2026-08-21 18:47:29 — `.git/worktrees`
and `.claude/worktrees` share that mtime to the millisecond, which is a `git worktree remove`
rather than a directory deletion, since the latter would leave a prunable registration behind.
It took 326 MB across 20 sources with it: the only copy.

**Why the safeguard did not fire**: `git worktree remove` refuses to discard a worktree with
uncommitted changes. That worktree had none — every commit was pushed, `git status` was empty.
But **"clean" counts only tracked files**, and gitignored data is invisible to it. A worktree
holding the sole copy of 326 MB looked disposable to the tool that removed it, and no warning was
possible because git could not see what was at stake.

This generalises past worktrees: any tooling that reasons about "is there unsaved work here"
answers using the index, so anything deliberately kept out of the index is outside that reasoning.
The fix is not to be more careful; it is to stop keeping irreplaceable data where the answer is
computed.

**Why pinning had to come with it**: the documented recovery path was re-fetch plus manifest
verification. Exercised for real, azure came back at a different commit with 17 of 58 files
changed and 1 gone — the manifest detected the drift, which is worth having, but could not undo
it. With the pin in place the same re-fetch now returns **58 of 58 files sha256-identical**, and
the byte-coverage assertion reproduces the original figures exactly (49 concepts, leaf 765,276 +
headings 9,732 = 775,008). Recovery is now real rather than nominal.

**Scope and remaining exposure**: the five `html` sources have no commit to pin — they are page
fetches, and re-fetching them will drift with the upstream site. Their manifests still record a
per-file `sha256`, so drift stays detectable, and none of them is currently ingested. This
matters before anything stores a `verbatim` citation: an unpinned source turns an upstream edit
into a citation that silently stops matching, which `content.includes()` reports only as `false`.
**Status**: active

## 2026-08-21 — The html manifests are refreshed to the re-fetched state, and sha256 is unreliable for pages that carry a nonce

**Decision**: after restoring the corpus, the five `html` sources' manifests are replaced with
the re-fetched state rather than kept at their pre-loss values. The pre-loss manifests described
a corpus that no longer exists and can never be obtained again, so keeping them would leave a
tracked record that permanently matches nothing. The measurement they would have preserved is
recorded here instead, which is the right place for it.

**Restoration, measured against the pre-loss manifests**:

```
15 git sources    5,905 files    5,905 identical      0 changed      0 missing
 5 html sources   1,533 files    1,151 identical    382 changed      0 missing
                  -------------------------------------------------------------
                  7,438 files    7,056 identical    382 changed      0 missing
```

The git side is byte-exact because of the pins added in the previous entry; before them the same
re-fetch of azure alone returned 17 of 58 files changed and 1 gone. Nothing is missing on the
html side either, because `fetch_html.py` now recovers its URL list from the manifest's
`source_url` rather than re-crawling — re-crawling would have returned a different set of pages,
since discovery follows whatever the site links today.

**The 382 needs reading carefully, not taking at face value**:

```
msio          0 / 53     clean
sre           0 / 102    clean
aws-wa        7 / 238    small, real
fowler      155 / 920    static site, most likely real content change
anthropic   220 / 220    not a measurement -- see below
```

**anthropic's 100% is an artifact.** Its pages carry a per-request CSP nonce
(`nonce="4hP3D4ayYLmS9EC6Z7pe+A=="`), so every byte-level hash differs on every fetch whether or
not a word changed. For pages like these **sha256 cannot function as a drift detector at all** —
it reports "changed" unconditionally, which is indistinguishable from reporting nothing. There is
genuine change mixed in (the first file grew from 790,146 to 865,301 bytes), but the hash cannot
separate it from the noise.

**Consequences worth carrying forward**:

- Do not treat an html source's sha256 mismatch as evidence of content change without first
  checking whether the page carries per-request content. A future drift report should strip
  nonces and similar volatile attributes before hashing, or the signal is worthless for the
  sources that most need watching.
- This sharpens the exposure noted in the previous entry. git sources are now reproducible;
  html sources are neither pinnable nor, in the nonce case, checkable. Anything that stores a
  `verbatim` citation against an html source is exposed to silent citation rot with no
  instrument that would detect it.
- None of the five is ingested today, so nothing is broken now. The constraint is on what may be
  admitted later, not on what exists.
**Status**: active

## 2026-08-21 — Implementation decisions settled while building SCRUM-45 US1, not fixed by the spec

Five points came up building T001–T011 that spec.md, plan.md and the two contracts did not
settle, plus one place where the implementation diverges from what a contract says.

**1. The evidence-is-a-substring rule is enforced on both sides of the wire, not one.**
contracts/extract.md states it as a field rule of `/extract`, and plan.md's Constitution Re-Check
assigns it to the Zod schema. Both are implemented: the extraction node checks each span against
`state.jd_text` and raises `AgentLLMError` (502), and `buildExtractResponseSchema` checks it again
against the submitted text. This is not redundancy for its own sake — each side is the last chance
to catch it before the value crosses out of that side's control, and the failure it prevents is
the one that hard constraint 1 exists for: a paraphrased span is stored as `evidence` and can
never be found in the posting it claims to quote. Drift between the two checks is benign, since
both are the same one-line containment test with no normalisation to disagree about.

**2. The Zod response schema became a factory rather than a constant.** `buildExtractResponseSchema(submittedText)`
returns the schema. The substring assertion cannot be made without the text, and Zod 3 has no
parse-time context to pass it through, so binding it at construction is the only shape available.
The client builds the schema per call.

**3. Merging repeated mentions happens in the service, not at the database.**
`@@unique([submissionId, normalized])` would reject the second row and take its evidence with it,
which is the opposite of what FR-003 asks for. The service merges by normalised phrase before
writing; the constraint remains the backstop. The first surface form seen wins — one of two
spellings has to be the one displayed, and the posting's first use is as defensible a choice as
any, provided it is deterministic. Two phrases that both normalise to the empty string therefore
collapse into one item, which is correct: the constraint would otherwise reject the second.

**4. The unavailable error gained a subclass, so 502 and 503 are actually distinguishable.**
contracts/http-api.md specifies `502` for "the inference service failed or returned a malformed
result" and `503` for "unreachable", but the existing client threw one error for both, so the
documented distinction was unreachable. `AgentOrchestrationUnreachableError extends
AgentOrchestrationUnavailableError` is thrown from the `fetch` catch — connection refused, DNS
failure, timeout — and every existing `instanceof AgentOrchestrationUnavailableError` handler
keeps working unchanged. A timeout counts as unreachable.

**5. The client's extract tests moved from `tests/unit/` to `tests/contract/extract.contract.test.ts`.**
tasks.md T006 names that path, which did not exist; the tests lived in
`tests/unit/agent-orchestration/agent-orchestration.client.test.ts`. They now sit beside
`embed.contract.test.ts`, which they mirror exactly — both stub `fetch` and assert the
cross-service contract.

**6. A feature-006 assertion was rewritten rather than deleted.**
`tests/contract/concept-doc-chunk-schema.test.ts` asserted that the corpus migration left
`jd_submissions` and `candidate_training_directions` untouched. That was true of that migration
and is deliberately false of the database now. What the assertion protected — that a migration
does not silently reshape the submission tables — is still worth stating, so it was restated
against the shape those tables are supposed to have, including that no `status` or
`rejection_reason` column survives for a sufficiency gate to record a verdict in (FR-022).

**Measured end to end** on 2026-08-21, real provider, real corpus, 2,284-character posting for a
senior backend platform role: 47 items extracted, 12 `exact`, 35 `unresolved`, 0 `similarity`
(tier 2 does not exist yet). No non-technical requirement became an item — citizenship, salary,
hybrid working and the recruiter note were all correctly left out. `rate limiting` and
`throttling` both appeared and resolved to their own concepts, as designed.

The unresolved list is the informative part, and it splits in two. Some are genuinely outside an
Azure-patterns corpus — Terraform, Kafka, PostgreSQL, gRPC, PCI-DSS. Others are concepts the
corpus **does** hold under a different name: `publish/subscribe model` against `publisher-subscriber`,
`API gateway` against the four gateway patterns, `bulkhead isolation` against `bulkhead`,
`strangler fig migration` against `strangler-fig`. That second group is precisely the population
tier 2 exists to recover, and it is now visible as a measurement rather than an argument.
**Status**: active

## 2026-08-22 — Implementation decisions settled while building SCRUM-45 US2 (the graph endpoint)

**Status**: active
**Source**: specs/007-jd-concept-graph, tasks T012–T016

Six things the spec, plan and contract did not settle, or settled wrongly.

**1. Relevance is the strongest single item that resolved to a concept, and it does not
propagate along edges.** An `exact` item contributes 1 — it is a recorded name, not a
measurement — and a `similarity` item contributes its score; a concept nothing resolved to is
0 (FR-011). Two decisions are folded into that. Repetition does not raise relevance, because
counting mentions would make a posting's repetitiveness look like emphasis. And relevance is
not diffused to neighbours, because the diffusion rate would be a number nobody has measured,
arriving in a response field that looks measured. The edges are already in the payload; a
client that wants neighbourhood weighting can compute it and own the choice.

**2. The inferred cut is a target mean degree of 10, not a similarity value.** FR-013 requires
this and the distribution explains why: concept-pair similarity across the 70 real vectors is
narrow — p5 0.248, p50 0.351, p95 0.484 — so a fixed cut sits inside the bulk, where a small
change in how vectors are built moves the edge count enormously. Edges are taken in descending
similarity until the target is reached, authored edges counting towards it, then any concept
still unconnected is given its single best remaining edge. On today's corpus the target lands
on 0.4384, close to the 0.44 measured by hand — but as an outcome, not an input.

**3. A pair that is both asserted and similar is reported once, as authored.** FR-012 forbids
merging the two kinds; it does not say what to do when both apply. Authored wins because a
document asserting a relationship is the stronger claim, and emitting the pair twice would
inflate the density and leave a client unable to say what it is looking at.

**4. `index` is excluded from the graph; `overview` and `patterns` are not.** `index` is an
Azure Architecture Center navigation page admitted through a `related` edge from `microservices`
and `throttling`. It has no material, and its vector — built from the word "index" alone — is
0.7135 similar to `index-table`, the single strongest pair in the corpus and completely
meaningless. FR-023 already calls for it to go, so `src/corpus/non-concept-ids.ts` excludes it
where the graph is derived. `overview` and `patterns` are the same kind of page and are
deliberately left in: excluding them would be a corpus admission call, and admission is a human
decision, not an engineering operation (CLAUDE.md hard constraint 7). The durable fix is an
exclusion rule in corpus admission; the graph-side list is the interim, and node count is 69
rather than the 70 tasks.md assumes.

**5. `threshold` is null, not a placeholder.** contracts/http-api.md shows the field populated,
but the calibration that produces it is US3 and has not run. A number there would be read as a
measurement — the exact failure FR-018 and FR-019b exist to prevent — so the field says there
is nothing to echo. `stats.inferredCut` was added alongside it: the graph's own cut is a
different quantity from the resolution threshold and hiding it would make the density
unauditable from the response.

**6. The response is about 35 KB, not the 12.4 KB the plan recorded.** 12.4 KB is roughly what
the node ids and edge pairs alone come to. The response contracts/http-api.md specifies also
carries a name, a corpus flag, a relevance and a matched-item list per node, and `kind` plus
`strength` on each of ~345 edges — around 83 bytes an edge. Inferred `strength` is rounded to
four decimals, as the contract's own examples write it, which saves about 3 KB of float noise.
The conclusion the 12.4 KB figure supported still holds — one response, no pagination, no
subgraph parameter — so the tests assert the measured size rather than the planned one.

**Measured end to end** on 2026-08-22 against the running service and the real corpus, a
five-item posting fetched through `GET /jd-submissions/:id/graph`: 69 nodes (20 of them grey),
105 authored edges, 240 inferred, mean degree 10.0, inferred cut 0.4384, 0 isolated concepts,
35,543 bytes. `rate limiting` resolved to `rate-limiting` at tier 1 and `throttling` sits one
authored edge away from it — the neighbour the colloquial phrase probably meant, surfaced by
the graph rather than by overriding an exact match.

**A test-isolation hazard surfaced, not introduced.** `tests/integration/ingest-corpus.test.ts`
creates and deletes `test-concept-*` rows while Jest runs suites in parallel, so any assertion
against a live concept count is a race against another file. The new tests exclude that prefix
and, where a count is unavoidable, sandwich the request between two reads. Worth fixing at the
source later; it is not specific to this feature.

## 2026-08-22 — Measured: grey concept vectors are degenerate, so they do not generate inferred edges

**Status**: active
**Source**: specs/007-jd-concept-graph (US2), measured against the shipped endpoint
**Supersedes**: item 4 of the 2026-08-22 SCRUM-45 US2 entry above, on `overview` and `patterns`

**The measurement.** Fetching the graph for a live submission and analysing the payload:

```
inferred edges          240 total
  grey-to-grey           69   (28.7%)
  random expectation           8.1%   -> 3.5x over-represented
highest-degree nodes    auto-scaling 30, caching 24, high-performance-computing 19,
                        patterns 19, messaging 18   -- five of the top eight were grey
```

**The cause is structural, not a data slip.** A grey concept has no source material, so its
vector is built from its name and terms alone. Short generic nouns — `caching`, `messaging`,
`patterns`, `overview` — therefore embed near one another *because they are short generic
nouns*, not because the concepts relate. The effect is not a few bad edges; it makes the
densest region of the point cloud the region with nothing behind it, where every node opens to
an empty concept. That is the opposite of the property the map exists to have.

**The rule**: inferred edges are computed only between concepts that have material. Grey
concepts stay in the graph and keep every authored edge — those were written by a document
author and are real — but they no longer receive edges derived from a degenerate vector.
Dropping the nodes would be the wrong fix: a grey node exists precisely to show that something
is known and unmaterialised.

This is FR-010's reasoning applied to edges rather than to matching. The requirement says a
representation built from a name alone must not be judged against the same threshold as one
built from real text; it holds identically for what that representation is allowed to assert
about relatedness.

**Both strategies measured against the real vectors**, choosing the cut by target mean degree
in each case, with the three navigation pages excluded:

```
                          cut     inferred   union   mean degree   isolated
all concepts             0.435       270       334       9.97          0
material-bearing only    0.401       268       331       9.88          0
```

Nearly identical density — but in the second, every inferred edge joins two concepts a user can
actually open. 0.401 is not hardcoded anywhere: the cut is still chosen to hit the target
degree, and it moved *because* the candidate pool changed. That is the behaviour FR-013 asks
for, visible in a real measurement.

**`overview` and `patterns` join `index` in the non-concept exclusions.** All three are Azure
Architecture Center navigation pages of the same class — `addedFrom: related-edge`, no material,
no `related` edges of their own. The earlier entry left them in because excluding them is a
corpus admission call and admission is a human decision (CLAUDE.md hard constraint 7); the user
made that call on 2026-08-22. Node count is 67 as a consequence of the rule, not as a target.

**Shipped shape**, fetched from the running service after both changes: 67 nodes (18 grey), 103
authored edges, 232 inferred, mean degree 10.0, inferred cut 0.4000, 0 isolated concepts, 0
grey-to-grey and 0 grey-touching inferred edges, all 18 grey nodes still carrying at least one
authored edge, 34,460 bytes. The highest-degree nodes are now `asynchronous-request-reply` 25,
`choreography` 25, `throttling` 24, `bulkhead` 23, `sequential-convoy` 22 — all
material-bearing.

**This outlives the feature.** Whenever the corpus is expanded, newly admitted concepts arrive
grey, and their vectors will be degenerate in exactly this way until material is attached. Any
future use of concept vectors — clustering, gap ranking, recommendation — has to decide what to
do about that, and "they embed by word shape, not by meaning" is the fact to start from.

## 2026-08-22 — Measured: the calibration baselines do not separate, so there is no threshold and no tier 2

**Status**: active
**Source**: specs/007-jd-concept-graph (US3, FR-016 to FR-019b), measured against the real corpus
**Record**: `docs/calibration/resolve-threshold.json`, regenerated by
`scripts/calibrate-threshold.ts`

**What was measured, and why this relation.** SCRUM-44 measured similarity between two
*different* concepts joined by a `related` edge and used it as a positive baseline; the
2026-08-11 correction above explains why the sign is inverted there. This run measures the
relation resolution actually performs: **a phrase against a concept**. The matching baseline is
147 phrases, three from each of the 49 concepts with material, drawn from that concept's own
source material. The non-matching baseline is the same phrases scored against the strongest
*different* concept — which is what resolution would do, since the best match wins.

```
                            n     min      p5     p50     p95     max    mean
matching (own concept)     147  0.1126  0.1921  0.3254  0.5766  0.6616  0.3481
non-matching (material)    147  0.2042  0.2606  0.3799  0.5092  0.8144  0.3825
non-matching (grey)        147  0.1793  0.2252  0.3408  0.5214  0.6182  0.3524

separation  p5(matching) - p95(non-matching) = -0.3171      NOT separated
```

**The distributions do not separate, and not marginally.** The *mean* non-matching score
(0.3825) is **higher** than the mean matching score (0.3481): a sentence from a concept's own
document is, on average, closer to some other concept than to its own. Stated the plainest way,
the concept a phrase was taken from is the strongest match for **50 of 147 phrases (34%)**. For
18 of the 49 concepts, not one of its three phrases identifies it; for only 4 do all three.

Per FR-018 no threshold is emitted. `scripts/calibrate-threshold.ts` writes
`src/resolve/calibration.ts` with `SIMILARITY_THRESHOLD = null`, and
`tests/unit/resolve/resolve-tier2.test.ts` fails the moment a number appears there without a run
behind it.

**Consequence: T021 is not built.** Tier 2 needs a calibrated threshold and there is none.
Resolution stays at tier 1 — an exact normalised lookup against `concept_terms` — and everything
it misses stays `unresolved`. That is not a partial delivery of US3; it is US3's stated outcome
for this case, and it is the one SCRUM-44's superseded entry is the precedent for. `unresolved`
carries a null score rather than "the best score seen", because nothing was scored.

**FR-019b, restated with the number in hand.** This is a floor and it was not cleared. Failure
here means the representation is inadequate and no wording will help; success would not have
established that real job-description wording reaches the right concept. The floor result makes
the second-stage calibration (real posting phrasings) pointless to run against these vectors:
there is nothing for it to improve on.

**Two circularity exclusions, because there were two records, not one.** FR-017 names
`concept_terms`. The less obvious one is the **preamble chunk**: a concept's vector is built from
its name, its terms, and the opening 500 characters of its preamble
(`scripts/ingest-corpus.ts`), so a phrase taken from there is scored against a vector partly
built from that same text. Phrases come from non-preamble sections only, with every recorded name
of the concept masked out. Masking is not extra strictness — tier 2 only ever sees phrases tier 1
did *not* match, so a phrase spelling the concept's name is not a case tier 2 would handle.

**A sampling bias found and fixed mid-run, recorded because the first number was wrong.** The
first implementation took the first three eligible sentences per concept. Sections sort by
`chunkId`, so that meant "Context and problem" for nearly every Azure pattern — the section
written to state a *general* difficulty before the pattern is named. The sample was therefore 49
generic problem statements, measuring a harder and different question. Phrases are now spread
evenly across each concept's whole eligible pool. It moved the top-1 rate from 40/147 to 50/147
and the verdict not at all.

**Grey concepts, per FR-010.** They are reported apart from the material ones throughout and
cannot move the threshold. The evidence for keeping them apart is direct: a grey concept
out-scores the best material non-match for 47 of 147 phrases and out-scores the phrase's *own*
concept for 82 of 147, and the top grey attractors are exactly the degenerate short generic nouns
the 2026-08-22 entry above identified — `auto-scaling` 21, `understand-data-store-models` 19,
`messaging` 15, `data-considerations` 15. A grey concept also has no matching baseline at all:
with no material it has no own words, so `greyMatching` is null by construction rather than by
omission.

**What this does not say.** It does not say `text-embedding-3-small` is the wrong model, and it
does not say the corpus is bad. It says these concept vectors — name + terms + 500 characters of
preamble, one vector per concept, no chunk-level vectors — cannot tell an Azure architecture
pattern's own prose from its neighbour's. The three candidate directions, none of them chosen
here: chunk-level vectors so a phrase is matched against the passage that discusses it rather
than against a whole-concept average; a larger embedding model, whose reconsideration trigger the
2026-08-11 correction explicitly declined to fire on the wrong evidence and which now has the
right evidence to weigh; or hand-authored aliases, which make tier 1 cover more and reduce what
tier 2 is asked to do. Choosing among them is a separate feature with its own measurement, not a
follow-up commit on this branch.

**Reproducibility.** The run was executed twice against the same corpus and reported identical
figures to four decimal places, which is SC-006 satisfied on real data — for a run that produces
no number, but the same machinery will produce a reproducible one when the representation
changes.

## 2026-08-22 — The calibration is TypeScript, not `corpus/tools/calibrate_threshold.py`

**Status**: active
**Source**: specs/007-jd-concept-graph (T017, T018)

tasks.md places the calibration at `corpus/tools/calibrate_threshold.py`. Its inputs are the
stored concept vectors and the stored chunks — both in Postgres — and
`specs/005-corpus-ingest-foundation/research.md` §1 settled that no Python process in this
repository connects to the database, precisely so that nobody has to re-litigate the
Constitution-IV judgment call each time. Honouring the filename would have reopened it, or else
required a JSONL export of 607 chunks and 67 vectors for a tool that reads them once.

It lives at `scripts/calibrate-threshold.ts` with the measurement logic split into
`src/calibrate/` as pure functions — vectors in, numbers out — so the two rules most likely to be
satisfied in name only, FR-017's independence and FR-018's refusal to emit a number, are driven
by unit tests rather than only by whatever the corpus happens to contain today. Tests are at
`tests/unit/calibrate/`, not `corpus/tools/tests/`.

## 2026-08-22 — `npm test` was silently emptying `doc_chunks` on every run

**Status**: active
**Source**: specs/007-jd-concept-graph (T024), fixing a defect introduced in
specs/006-corpus-structure-rebuild

The corpus table emptied itself three times over two features with no apparent cause. A plain
`scripts/ingest-corpus.ts` run persisted correctly, no migration was being replayed, and the
integration tests looked like they cleaned up only their own fixtures. The cause is
`tests/integration/ingest-corpus.test.ts`, "preserves total leaf byte coverage after a full
ingest into the database".

That test deliberately reads the **real** `corpus/_meta/chunks/azure.jsonl` — that is the point
of it, proving the loader loses nothing on the way into Postgres. So its `testConceptIds` is not
a fixture id but every one of the 49 real corpus concepts, and its `finally` block ran
`docChunk.deleteMany({ where: { patternId: { in: testConceptIds } } })` — every chunk of every
real concept. Concepts survived because their delete carries `addedFrom: 'test-fixture'`; the
chunk delete had no equivalent guard, so the asymmetry left a database that looked half-intact
and pointed at nothing in particular.

Reproduced deliberately before fixing, because a green suite that destroys data is exactly the
failure that hides: with the old teardown the suite reports `10 passed` and leaves `doc_chunks`
at 0; with the fix it reports `10 passed` and leaves all 607 rows.

**The rule this establishes.** A test's teardown may delete only what that test can prove it
created. Deleting by a *selector* the test also shares with production data is not cleanup, it is
a truncate with extra steps. Teardown now snapshots the chunk ids present before the ingest and
removes only ids that were not there — on a populated database that is nothing at all, since
`ingestChunks` is content-hash keyed and rewrites the same ids, and on an empty one it is all of
them, which is equally "as found".

The pattern generalises to the concept guard as well, which got this right by accident:
`addedFrom: 'test-fixture'` is a provenance marker, and provenance is what makes "did this test
create this row?" answerable. Where a table has no such marker, snapshot instead.

## 2026-08-22 — SC-003 corrected from 12 KB to the measured 34 KB

**Status**: active
**Source**: specs/007-jd-concept-graph (T024)

SC-003 required the whole graph in one response "of roughly 12 KB, matching the measured size".
No such measurement had been taken. The figure was estimated during planning against a payload
that node ids and authored edges alone would produce — before `matchedItems`, `hasCorpus`,
per-node relevance, and the 232 inferred edges that FR-013's density target requires all became
part of the contract. The response as `contracts/http-api.md` specifies it measures **34,491
bytes** for the 67-node, 335-edge graph, about 83 bytes per edge, all of it required to draw the
map.

The conclusion the number was supporting is untouched: one response, no pagination, no subgraph
parameter, no lazy expansion. So the criterion is restated at the measured size rather than left
standing as a success criterion the implementation knowingly fails. A repository that carries a
criterion everyone has privately agreed to ignore is worse off than one that carries none — the
next reader cannot tell which of the ten are real.

Corrected in three places that all repeated the estimate: `spec.md` SC-003 (with the reason),
`contracts/http-api.md`, and the doc comment on the graph endpoint. The integration test at
`tests/integration/submit-to-graph.test.ts` already bounded the real size and explained the gap;
it needed no change.

## 2026-08-22 — `prisma migrate reset` was not run, and why that is acceptable here

**Status**: active
**Source**: specs/007-jd-concept-graph (T024)

T024 called for verification from a reset database. The Prisma CLI now refuses a destructive
`migrate reset` when it detects it was invoked by an agent, and demands the user's own recorded
words as consent. That refusal was respected rather than worked around.

What T024 actually needed from the reset was that the migration chain applies to a schema nothing
had hand-patched, and that the corpus rebuilds from source rather than from whatever happened to
survive. Both were obtained without dropping the database: `prisma migrate status` reports 4
migrations found and the schema up to date with no drift, and the corpus was rebuilt end to end
from the raw sources — `chunk_azure.py` regenerating 607 chunk rows over 49 concept-eligible
files, then `ingest-corpus.ts` replacing all 49 files' chunks and rebuilding all 147 terms.

What was *not* re-proved is that the four migrations apply cleanly to an empty database in
sequence. That is worth someone running once with consent before merge; it is the one claim in
T024 that this verification does not support.

## 2026-08-22 — Independent review of the resolution and calibration assertions (T025)

**Status**: active
**Source**: specs/007-jd-concept-graph (T025)

The test-reviewer subagent was asked, against the spec and the final code only, whether five
assertions actually check what they claim or merely look like they do. Three came back adequate,
two weak. Recorded because the two weak ones are the kind of finding that a green suite hides.

**Adequate, confirmed by evidence not by assertion.** FR-017's non-circularity is tested for
*both* circular sources independently — `tests/unit/calibrate/phrase-sampling.test.ts` asserts a
preamble-only chunk yields zero phrases, and separately that every recorded name is masked out —
so a leak of either kind fails a test. FR-013's target-degree edge selection is pinned by a
synthetic distribution where every pairwise similarity sits below 0.44, which a hardcoded-0.44
implementation would turn into an empty graph; the test asserts the real one still reaches the
requested degree. The grey-concept rule is asserted at both the unit and the contract level.

**Weak, and fixed: nothing tied the threshold in force back to a run.** Every test asserting "no
threshold" read `SIMILARITY_THRESHOLD` from the generated `src/resolve/calibration.ts` directly.
Hand-editing that file to `0.35` and flipping `separated` to `true` would have left the suite
green — producing exactly the number-with-no-run-behind-it that FR-016 forbids and that the
2026-08-11 correction is the precedent for. The refusal *mechanism* was well tested; the
*artifact* was not tied to it.

`calibrationModule()` moved out of `scripts/calibrate-threshold.ts` into
`src/calibrate/calibration-module.ts` (the script's `void main()` would otherwise run on import),
and `tests/unit/calibrate/calibration-module.test.ts` now re-renders the module from the
committed record and compares it byte for byte, with a second case proving the generator does not
simply always write null. Verified by deliberately editing the threshold to 0.35 and watching the
test fail. This does not prove the record itself is honest — re-deriving it needs the database
and 147 embedding calls, which a unit test must not make — but it raises the cost of a fabricated
threshold from editing one literal to forging a 147-row record of per-phrase scores, and makes
any drift between the two files a failure.

**Weak, and deliberately not fixed: FR-008 cannot be tested until tier 2 exists.** No test proves
a future tier 2 would reject a below-threshold nearest match rather than fall back to it, because
no code computes a score to compare. Writing one now would mean building the tier the measurement
says must not be built. The requirement is recorded at the top of
`tests/unit/resolve/resolve-tier2.test.ts` as the first test to write when a calibration ever
produces a number — nearest-match fallback being the single most likely way tier 2 gets built
wrong, since it is what every vector-search example does by default and it looks like it works.

## 2026-08-22 — Implementation decisions settled while building SCRUM-47 (the concept map client)

The brief settled the big ones: one static page served by the existing NestJS app, no framework,
no build step, no new runtime dependency, a hand-written force layout, and the four properties
that must be visible. These are the calls it did not make.

**The transform is a module with a hand-written `.d.ts`, not script inside the page.** Everything
between the two API responses and the drawing — degree counting per edge kind, the unresolved
list, the threshold sentence, the neighbour ordering — lives in `public/graph-view-model.js` and
is covered by `tests/unit/concept-graph/graph-view-model.test.ts`. The browser needs it as plain
JavaScript and the test needs it without a DOM, so it cannot be TypeScript compiled at build time
(there is no build step) and it cannot be inline `<script>` (nothing could import it). The types
therefore live in `public/graph-view-model.d.ts`, written by hand and added to `tsconfig.json`'s
`include`; `eslint.config.js` gains `public/*.js` in `allowDefaultProject` for the same reason.
The physics is deliberately *not* tested: a spring embedder has no correct answer to assert, and
a test pinning particular coordinates would only pin the constants.

**Unresolved items come from the submission response, not the graph.** `GET /:id/graph` carries
no unresolved items and should not — an unresolved item resolved to no concept, so it is not a
node. The page keeps the `POST` response alongside the graph and joins the two client-side. This
is the only source, which has a consequence recorded below.

**`?submission=<id>` reopens a stored graph, and says so when the gap list is missing.** The
graph endpoint is a database read; submitting re-runs extraction, which takes tens of seconds and
sometimes fails. Being able to return to a map without paying for it again is worth the caveat:
on a cold browser there is no submission response, so the gap panel says the posting's unresolved
items are unavailable rather than showing an empty list, which would read as "nothing was
missing" — the exact opposite of the truth. Within one browser session the response is cached in
`sessionStorage` beside the id and survives reload.

**The layout is seeded and framed, not random.** Start positions come from a fixed-seed LCG
rather than `Math.random`, because the graph endpoint is guaranteed identical across requests for
a submission (FR-015) and a map that rearranged itself on every reload would hide that property
instead of showing it. Once the simulation settles the view is scaled to fit the canvas; before
that was added the graph sat as a knot in about a third of the width, which made the density look
far higher than it is.

**Labels are dropped rather than overlapped.** Names are placed greedily — focus first, then by
relevance — above the point or, failing that, below it, and any that would collide with an
already-placed name or with another concept's disc is not drawn. Two names on top of each other
read as a third, wrong name, which is worse than a missing one. With 20 matched concepts in the
dense middle this shows about 16 of them; the `all labels` toggle and zoom recover the rest.

**Found while building: `toScreen` mixed device and CSS pixels**, so on a 2x display the whole
layout drew at half scale. Recorded because it was invisible on a 1x display and only showed up
against a real 67-node graph — the class of bug a screenshot catches and a unit test never would.

**Found while building, and *not* a client concern: extraction rejects roughly a third of long
postings.** `POST /jd-submissions` returns 502 intermittently — measured 3 failures in 7 attempts
on the same ~1.5 KB posting — with agent-service reporting e.g. `evidence for 'gateway
aggregation' is not a substring of the submitted text`. The model returns an evidence span with
whitespace normalised, most readily where the posting hard-wraps a line, and the verbatim guard
correctly refuses it. The guard is right; the retry story around it is missing. Not fixed here —
it is an agent-service concern, and a client that silently retried would hide it.

## 2026-08-22 — Build the visible thing earlier; it tells you what the invisible thing should be

**Decision**: refine how the 2026-08-08 priority rule is applied. That entry says to prefer the
branch with more AI-engineering substance at a fork, and it stands. It does not say to build the
whole backend before anything is visible, and it was being read that way.

**The evidence is this project's own history.** SCRUM-42, 44 and 45 delivered the corpus layer
and the resolution pipeline over several days, all of it invisible. SCRUM-47 put a client in
front of it in a single agent run, and within an hour of looking at the result four things
surfaced that no amount of terminal measurement had produced:

* The layers are inverted. The map is the corpus with the posting relegated to a side panel, so
  a posting naming Go, GraphQL and Kafka shows none of them, and every uncovered posting produces
  an identical map carrying no information about the submission.
* 28% of a posting's unresolved items literally contain a registered concept name —
  `ambassador patterns`, `retry patterns`, `event-driven flows`. Tier 1 does exact equality, so it
  misses all of them. A containment pass is an afternoon of work and no corpus change.
* The unresolved list is dominated by product names — Go, Kafka, Kubernetes, PostgreSQL — which
  under this project's own alias rule should never become concepts. That reframes what
  "the corpus does not cover this role" actually means.
* Node granularity is wrong: a posting's surface vocabulary is languages, frameworks, tools and
  paradigms, while the map shows architecture patterns.

Feature 008, corpus expansion, had a complete specification and was parked the same day, because
seeing the map changed which problem was worth solving.

**Why this is not a contradiction.** The priority rule governs *which branch to take at a fork*,
not *what order to build in*. Choosing verifiable retrieval over a prettier product is still
right. Deferring every visible surface until the invisible layers are finished is a different
claim, and the measurement above says it costs more than it saves — the visible artifact is an
instrument, not a reward for finishing the backend.

**What changes in practice**: when a feature would produce something a person can look at, prefer
sequencing it before further depth on what feeds it, unless the depth is a prerequisite rather
than an improvement. The corpus layer genuinely was a prerequisite — there was nothing to render
before SCRUM-44. Corpus *expansion* is an improvement, and it should have waited, as it now has.
**Status**: active
