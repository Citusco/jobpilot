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
