# JobPilot Design Document

> This document is the source of truth for design decisions, meant to be kept loaded by
> the development agent at all times.
> It records the reasoning — the **why**, not just the **what** — so that when a judgment
> call comes up, the reasoning here should drive the answer, not generic best practice.
>
> **This document supersedes `jobpilot-plan-v2.md`.** That earlier document was written
> before the pivot away from coding questions; roughly half of its content is now stale.
>
> Marker convention: **[DECIDED]** confirmed · **[OPEN]** needs a human call ·
> **[VALIDATED]** backed by experimental data

---

## 0. Positioning and scope [DECIDED]

**The product positioning hasn't changed**: an interview-prep platform for live-coding /
interview readiness, whose end state must still be able to produce a credible competence
assessment.

What changed is **how we get there**: because there's no directly comparable product on
the market — no existing answer to copy — we're iterating from the smallest viable scope
toward the goal, rather than designing the whole thing up front.

> ⚠️ This point was once mis-stated as "positioning shifted from assessment to a learning
> tool." That statement was wrong and has been corrected.
> Don't cut the data-model fields that support assessment rigor (observable difficulty
> dimensions, question versioning, the full context of an attempt) just because "it's only
> a learning tool."

### Priority arbitration rule [DECIDED]

The author's primary goal is to **learn AI engineering and use this project for job
applications**; product usability is secondary.

**At a fork in the road, take the branch with more AI-engineering substance.**

This rule resolves a long-standing back-and-forth: how accurate difficulty calibration is,
how realistic the questions feel, how broad the coverage is — these are product concerns,
and it's fine to leave them rough.

---

## 1. Abandoned directions (do not resurrect) [DECIDED]

| Direction | Why abandoned |
|---|---|
| ❌ Coding questions / live-coding | "Too shallow to matter, too deep to be tractable." Also drags down: Judge0, harness, sandboxing, difficulty calibration |
| ❌ Mining/blanking real GitHub repos for questions | Triple cost of licensing + dependency compilation + question-worthiness filtering — not worth it for a solo project |
| ❌ Swapping in a container runner to support framework questions | Concept questions don't execute code, so the need disappears |
| ❌ Multi-agent collaboration | No parallelism need, no isolation need. See §6 for detail |
| ❌ Training RAG on public datasets (SQuAD / MS MARCO / BEIR) | Those are academic benchmarks — the corpus is already chunked and cleaned by someone else; using them only lets you tune retrieval, and you lose the entire corpus-governance and product narrative |
| ❌ An agent that autonomously searches for and ingests authoritative sources | Destroys the core value proposition and creates license/legal risk. See §9 for detail |

**Constitution impact**: Judge0 is no longer needed; that technology-stack lock should go
through the amendment process to be removed, with the rationale recorded as "scope
reduction — code execution no longer needed."

---

## 2. Product form [DECIDED]

**Input a JD, output a practicable syllabus. Every question is a concept question (in
decision-question form).**

### Question form

Given a concrete scenario plus 2–3 candidate approaches, the candidate must state, for
each approach: one benefit, one cost, and the condition under which they'd choose it.

```
❌ Don't ask: "What is CQRS?"                    — a recall question
✅ Do ask:    "A team of 5. The query endpoint's p99 is already at 800ms.
              Write volume is low but reads outnumber writes 200:1.
              Someone proposes adopting CQRS. State the three questions
              you'd ask, and the conditions under which you'd reject
              the proposal."                      — a judgment question
```

**Core selling point = core technical through-line**: every judgment must trace back to a
verbatim excerpt from an authoritative document.

This is the one place where product value and the learning goal fully overlap — when in
doubt about a tradeoff, lean this way.

### The easiest pit to fall into

The failure mode for concept questions is **degenerating into rote Q&A**. The test: if a
question would get the same answer from asking ChatGPT directly, it has no product value.
What has diagnostic value is "can you recognize that a tradeoff exists here," not "do you
know this term."

---

## 3. Conclusions from two real experiments [VALIDATED]

These two experiments are the direct source of many design decisions — do not overturn
them.

### Experiment 1: basic feasibility

**Method**: manually pasted microservices.io's and Azure's CQRS pages into a prompt, asked
for decision questions with verbatim citations attached.

**Result**: question quality exceeded expectations (concrete scenarios, options with real
tension, usable grading notes), but a serious problem surfaced —

```
Option A (API Composition), cost field:
  text:     "Lacks CQRS's dedicated optimization for read performance
             and query models"
  verbatim: "Supports multiple denormalized views that are scalable and performant"
            ↑ this excerpt is actually describing a *benefit* of CQRS, repurposed
              as evidence for a *cost* of API Composition
```

**The key finding: the model didn't fabricate the source text, but it fabricated "the
source text supports this claim."**

This verbatim excerpt genuinely exists in the document, so `content.includes(verbatim)`
**would pass**.

**Root cause**: the prompt required benefit and cost to be filled in, but gave no escape
hatch for "insufficient material." The model was forced to fill them in and had no choice
but to force a fit. This is a prompt-design flaw, not a model flaw.

### Experiment 2: added a "leave it blank" constraint

**Change**: only the fact-layer paragraph was modified, adding:
- The verbatim excerpt must be **direct support** for the claim; merely mentioning the
  option's name, or text that only appears while discussing a *different* option, does not
  count as support
- When no support can be found, set the field to null and record the reason in a top-level
  `gaps` array
- Forbidden to use text discussing option X as evidence for option Y
- **Leaving a field blank is an acceptable outcome; forcing a fit is not.**

**Result**:
- ✅ Option A's benefit / cost all became null, with three complete `gaps` entries
- ✅ B / C's valid citations were **not collaterally damaged** — quality actually improved
  (B gained a genuine new `when_to_choose` citation)
- ⭐ **The model spontaneously did two things right**:
  1. Added a `when_to_choose_verbatim` field that wasn't in the schema
  2. For one weak piece of evidence, proactively declared it "only usable as weak support"

### Four rules established from this [DECIDED]

1. **Retrieval must happen up front, not be verified after the fact.** Post-hoc
   verification can only make a binary pass/discard call — it can't correct anything, and
   the discard rate would be high.
2. **Evidence strength is three-tiered, not binary**: `direct | weak | null`. This
   formalizes the model's own spontaneous behavior.
3. **`when_to_choose` must also be sourced.** It's a factual claim just like benefit / cost
   — the original schema was missing this.
4. **The `gaps` array is a trigger for corpus gaps**, not just an error log.

### Open issues carried forward

- Option A became a hollow shell — as a question presented to the user, it's crippled →
  **the root cause is insufficient material, not the prompt** → **retrieval should be
  per-option, not per-topic** (API Composition has its own dedicated page; it just wasn't
  fed in that time)
- Option A's `when_to_choose` exhibited circular reasoning ("choose A when A is good
  enough") → this shows the constraint stopped *fabrication* but didn't stop *vacuity*. May
  need a future rule: `when_to_choose` must contain a decidable condition (read/write
  ratio, team size, consistency requirement) — it can't just restate itself.

---

## 4. Architecture

### 4.1 Service split [DECIDED]

| Service | Responsibility |
|---|---|
| **NestJS / TypeScript** | All persistence (including vector tables), the retrieval layer, the concept graph, diagnostic statistics |
| **Python / FastAPI** | LLM inference orchestration, the LangGraph state graph, structured-output constraints |

**Python does not connect to the database** — when it needs data, it asks NestJS over
HTTP. Consistent with Constitution Principle IV; **no constitutional amendment needed**.

**Rationale (interview-ready)**:

> Retrieval and inference are two different engineering problems — retrieval is
> information retrieval + database optimization; inference is orchestration + state
> management.
> The boundary is drawn by "follows the data vs. follows the ecosystem," not by "which
> code looks AI-ish."

### 4.2 Main pipeline: eight steps

Each step is annotated with how it's executed. **The whole pipeline makes only three LLM
calls.**

| # | Step | Executed by | Input → Output | Why this way |
|---|---|---|---|---|
| ① | extract | **LLM** | JD text → terms JSON | Deciding which items are technical, required vs. nice-to-have from prose is a judgment call rules can't express |
| ② | resolve | **DB** | terms → concept_ids | Alias exact match with a vector fallback — both are table lookups |
| ③ | combine | **code** | concept_ids → option groups | Walk the `related` edges — the edges are authored in the documents themselves |
| ④ | retrieve | **DB** | option groups → chunk rows | Known ids, fetch the data — one SQL query |
| ⑤ | generate | **LLM** | chunks → question JSON | Picking material, crafting the scenario, composing the question — all judgment |
| ⑥ | verify (verbatim) | **code** | question → pass/fail | `content.includes(verbatim)` — one line |
| ⑦ | verify (entailment) | **LLM** | claim+verbatim → three-way enum | "Does the citation actually support the claim" can't be expressed with rules |
| ⑧ | display | **code** | question → syllabus view | Rendering |

> **Remember this ratio**: most of the engineering effort in an LLM application isn't in
> calling the model — it's in the deterministic processing before and after the call.

### 4.3 One data point's full journey

```
JD source excerpt
  "...read performance must be tuned separately from writes..."
        ↓ ① extract [LLM]
  { surface: "read-write separation", kind: "architecture",
    requirement: "required", evidence: "read performance must be tuned separately..." }
        ↓ ② resolve [DB]
  Alias table misses → vector search → cqrs (0.87 > threshold)
  { concept_id: "cqrs", method: "vector", score: 0.87 }
        ↓ ③ combine [code]
  Look up cqrs.related → { options: ["cqrs", "api-composition", "event-sourcing"] }
        ↓ ④ retrieve [code]
  SELECT * FROM doc_chunk WHERE pattern_id = ANY($1) AND kind IN ('benefit','cost','when')
  → 9 rows, including:
  { chunk_id: "azure:cqrs:cost:3", label: "Eventual consistency",
    content: "When the read databases and write databases are separated,
              the read data might not show the most recent changes immediately...",
    citable: true }
        ↓ ⑤ generate [LLM]
  { scenario: "An e-commerce SaaS... read/write ratio ~40:1...",     ← form layer, freely constructed
    options: [{ label: "B", name: "CQRS",
      cost: { text: "Must accept eventual consistency; queries may lag behind writes",  ← paraphrased
              verbatim: "the read data might not show the most recent changes",  ← word-for-word
              chunk_id: "azure:cqrs:cost:3", strength: "direct" }}],
    gaps: [...] }
        ↓ ⑥ verify verbatim [code]
  chunk("azure:cqrs:cost:3").content.includes(verbatim) → true ✅
        ↓ ⑦ verify entailment [LLM]
  Input is only { claim, verbatim } — no scenario, no other options, no generation trail
  Output: "SUPPORTS" ✅
        ↓ ⑧ display
  【Practicable】The read-write separation tradeoff
  【Identified, no practice yet】Kafka
```

**⑤ contains three kinds of text, with fundamentally different properties**:

- `scenario` — freely authored by the model (**form layer**)
- `text` — paraphrased by the model (may be reworded, but must not go beyond the material)
- `verbatim` — the source text word-for-word (**fact layer**; if this is altered,
  verification fails)

**⑦'s input is deliberately incomplete** — having the author judge their own work has no
value.

### 4.4 Fact layer / form layer separation [DECIDED, validated effective]

What goes into the generate prompt:

```
【FACT LAYER — strictly constrained】
benefit / cost / when_to_choose must correspond directly to statements in the reference
material, with an attached verbatim excerpt. The verbatim excerpt must be direct support
for the claim; merely mentioning the option's name, or text that only appears while
discussing a different option, does not count as support. When no support can be found,
set the field to null and record it in gaps.
Forbidden to use text discussing option X as evidence for option Y.
Leaving a field blank is an acceptable outcome; forcing a fit is not.

【FORM LAYER — free to construct】
The scenario setup, team size, business context, and specific numbers are yours to
construct, as long as they don't contradict the facts in the reference material.
Constructed numbers must support the reasoning behind the correct answer
(e.g., if the read/write ratio is close to 1:1, it should not point toward the conclusion
that "read-write separation has value").
```

**Separating these two layers is what prevents two distinct failure modes**: the model
drifting away from the material and making things up (fact layer breaking down), and the
model only ever echoing the source document, turning into a search engine (form layer
having no room to work).

### 4.5 Framework selection [DECIDED]

| | Use it? | Rationale |
|---|---|---|
| **LangGraph** | ✅ Yes, a minimal subset | See below |
| **LangChain core abstractions** | ❌ No | See below |
| **LangChain's text splitters** | ❌ **explicitly no** | Would break H3-level and item-level chunking, and isn't exactly reproducible |
| `langchain-core`'s `@tool` | ⏳ Introduce at P2 | Needed once an agent loop wraps `retrieve_docs` |

> **Note on scope**: this "no LangChain" stance applies specifically to the new §4.2
> eight-step pipeline described in this document. It does not retroactively apply to the
> already-shipped SCRUM-41 `agent-service` LLM client (`agent_service/llm.py`), which
> deliberately uses `langchain_openai.ChatOpenAI` per a separate, already-agreed
> constitution amendment (v2.1.0). The two decisions are scoped to different code and are
> not in conflict — see `docs/DECISIONS.md` for the explicit reconciliation.

> **LangGraph is not part of LangChain — it's a different product from the same company,
> with an opposite design philosophy.**
> LangChain provides high-level abstractions that hide detail; LangGraph provides
> low-level primitives (a state machine) where the code inside each node is entirely
> yours.
> **One makes decisions for you, the other gives you structure.** We want control, so we
> only take the latter.

#### Why use LangGraph (four reasons, in order of importance)

1. **LangSmith's node-level tracing is free evals infrastructure** — every node's input,
   output, token count, and latency is recorded automatically. When doing attribution
   analysis ("which node caused the problem"), that data doesn't need to be instrumented
   by hand. **This is the strongest reason to use it right now.**
2. **The `verify fails → generate` retry edge is naturally a graph structure** — expressing
   it as a graph is clearer than a `for` loop with `continue`.
3. **Explicit state** — `SyllabusState` carries terms / concepts / chunks / gaps /
   attempt_count without threading parameters through layers of function calls.
4. **When the P2 agent loop is added, the architecture doesn't need a rewrite** — it's just
   one more conditional edge and a tool node.

Honest self-assessment: **without reason #1, today's linear pipeline could be written in
20 lines of plain `await` code and would be more readable.** It becomes a genuine
necessity at P2, with gaps-driven re-retrieval (dynamic routing + state accumulation +
budget control).

#### Why not LangChain

Its core value is as an **adapter layer**: it hides differences between providers,
vector stores, and document formats.
**That value has a precondition: you actually have multiple swappable options.**

| LangChain component | Solves | Our situation |
|---|---|---|
| LLM abstraction | Swap providers without changing code | ❌ Constitution locks us to OpenAI |
| Retriever / VectorStore abstraction | Swap retrieval backends | ❌ Retrieval lives on the NestJS side, and it's SQL |
| Loader | PDF / Word / Notion and other formats | ❌ Everything is markdown |
| Splitter | Generic chunking | ❌ Covers only ~30% of the requirement, see below |
| LCEL / Chain | Composing multi-step flows | ❌ The pipeline is linear |

**⚠️ "Multiple sources" is not the same as "multiple formats."** We have 20 sources, but
they're all markdown or HTML that can be extracted to plain text — `open().read()` is
enough. The real difference isn't in format, it's in **structure** (Azure has a fixed
template; Fowler is prose) — and neither Loader nor Splitter solves that difference; it
needs a different processing strategy per source type.

**Why `MarkdownHeaderTextSplitter` isn't enough**: it can split on H2/H3 (~30% of the
requirement), but it can't give item-level chunking, code-fence protection, kind regex
matching, `related`-link extraction, `:::image:::` cleanup, or contextual prefixes. Pulling
in a dependency for 30% of the need, and splitting the chunking logic into "half framework,
half your own code," makes debugging harder. **Writing it ourselves is ~80 lines, all the
logic in one file.**

#### On "we might switch models / use a cheaper model later" [DECIDED]

That concern is reasonable, but **the refactor cost is overestimated by an order of
magnitude**.

The provider SDK is touched in exactly three places across the whole system (extract /
generate / verify-entailment). The real cost of switching providers is **80% re-tuning
prompts and re-verifying output stability** (different models react differently to the
same instructions, have different JSON reliability, have different unique capabilities
that go unused) — **and LangChain doesn't help with any of that part.** What it saves is
the remaining 20%, which was only half a day of work to begin with.

Introducing it early carries three real costs instead:
- It sits between you and your prompts (our prompt wording is sensitive, and verbatim
  verification is sensitive to exact text)
- LangChain's API changes frequently, so you'd be paying maintenance for abstractions
  you're not using
- In an interview, "so it's easier to switch models later" as the answer exposes that you
  haven't thought through where the actual cost lives

**✅ Three things worth doing right now (zero cost, genuinely reduce future refactor
cost):**

```
① Collapse all LLM calls into a single llm.py; business code never imports the
   provider SDK directly
② Make the model name configurable, not hardcoded     ← directly solves "use a cheaper
   MODELS = { extract: "...-mini", generate: "...", judge: "...-mini" }   model"
③ Define inputs/outputs with Pydantic, provider-agnostic
```

Do these three and switching providers becomes "add a branch in `llm.py`." **And these
three things are good engineering on their own — not something done to prep for
LangChain.**

#### When it's actually worth re-evaluating

Not "we might switch models someday," but these concrete signals appearing:

```
□ Actually running two or more providers simultaneously, with a real need for fallback
□ Need to ingest three or more heterogeneous data sources (Notion / Confluence / S3 ...)
□ Need to try multiple retriever strategies and hand-rolling them is too slow
□ Team collaboration needs a unified stack
```

If that day comes, **LiteLLM may be a better fit than LangChain** — it does exactly one
thing, provider unification, as a thin wrapper that doesn't take away control.

#### Legitimate reasons for needing multiple models (kept for reference)

Will come up as we scale up later; recorded here:

| Reason | Explanation | When we'd hit it |
|---|---|---|
| **Cost tiering** | Small models for structured extraction / binary classification, large models for reasoning — 10–20x cost difference | P2, when doing evals (judge uses a cheap model) |
| **Capability tiering** | Long context / code / multilingual / JSON reliability each have different specialists | Cross-language features (P3) |
| **Fallback resilience** | Fall back when the primary provider is rate-limited or down | At production time |
| Data compliance | Sensitive data routed to a local model | Not applicable |
| A/B evaluation | Run the same prompt across providers to compare quality/cost/latency | Could be eval material |

Note: **we're technically already using "multiple models"** — chat model for generation,
embedding model for resolve. They're just used so differently that no abstraction layer is
needed.

---

## 5. Two tables [DECIDED]

**These are two different tables, related by id, but with independent lifecycles.**

### The `concept` table (used by resolve) — one row is a concept's identity card, no source text

| concept_id | name | aliases | kind | related | has_corpus | embedding |
|---|---|---|---|---|---|---|
| `cqrs` | CQRS | `[Command Query Responsibility Segregation, read-write separation, ...]` | architecture | `[event-sourcing, api-composition]` | ✅ | `[0.02, ...]` |
| `kafka` | Apache Kafka | `[kafka, event streaming, message broker]` | platform | `[pub-sub]` | ❌ | `[...]` |
| `copilot` | GitHub Copilot | `[copilot]` | tool | `[]` | ❌ | `null` |

Scale: 100–200 rows. **You define these — they aren't scraped.**

Key fields:
- `has_corpus` — I know this concept exists, but do I have material for it
- `kind` — `tool`-kind entries are filtered out and never questioned on, **and don't count
  toward the coverage denominator either**
- `embedding` — encodes not the `name` alone, but `name + all aliases + a one-line
  description` concatenated together
- `status` — `active | deprecated | rejected`
- `added_from` — `seed | gap:jd-batch-3`, provenance tracking

Seven `kind` values: `language / framework / platform / architecture / practice / tool /
domain`

> ⚠️ **Don't spend time agonizing over classification boundaries.** Whether REST is
> `architecture` or `practice` has no clean answer.
> `kind` has exactly two real uses: filtering out things that shouldn't be questioned on
> (`tool` / `domain`), and routing to different question types.

### The `doc_chunk` table (used by retrieve) — one row is a piece of source text

| chunk_id | pattern_id | kind | label | content | source_url | citable | kind_confidence |
|---|---|---|---|---|---|---|---|
| `azure:cqrs:cost:3` | `cqrs` | cost | Eventual consistency | `When the read databases...` | learn.microsoft.com/... | ✅ | regex |

Scale: hundreds to thousands of rows. `pattern_id` is a foreign key.

`kind_confidence` (`regex | llm | manual`) lets you later filter down to just the
LLM-labeled portion to re-review it, without rerunning the whole pipeline.

### Why it has to be two tables

```
If there were only doc_chunk:
  JD mentions Kafka → lookup fails → the system only knows "no material"
  It has no idea what Kafka even is, what category it belongs to, or what it relates to
  → the gap queue can only record a lone, context-free string

With the concept table:
  → we know it's a platform-kind concept, related to pub-sub, and appears 15 times in JDs
  → the gap queue can produce an actionable to-do
```

**The concept graph is "I know this thing exists"; the corpus is "I have material for
it."**

### Three coverage states

| State | concept | doc_chunk | System behavior |
|---|---|---|---|
| Fully covered | ✅ | ✅ | Normal question generation |
| Known but no material | ✅ | ❌ | Ungrounded degradation (see §10) + enters the gap queue |
| Completely unrecognized | ❌ | ❌ | `unresolved` + enters the gap queue, **and the concept must be backfilled first** |

### Id naming [DECIDED, not to be violated]

- `concept_id` follows Azure's filename style uniformly (lowercase, hyphenated)
- **Once in the database, ids may never be renamed.** Only add a new one + mark the old one
  `deprecated`
- Reason: `doc_chunk.pattern_id` is a foreign key to it; renaming would sever every chunk
  association and leave historical answer records pointing at nothing

---

## 6. Where RAG / retry loops / agents belong [DECIDED]

### RAG isn't a single node, it's a path through the pipeline

| RAG stage | Corresponding step |
|---|---|
| Indexing | Fetch / chunk / kind-classify / corpus tables |
| Retrieval | ④ retrieve |
| Augmentation | ⑤ generate's prompt assembly |
| **Grounding** | ⑥ verify verbatim + ⑦ verify entailment |

**That last row is this project's differentiator.** Most RAG systems stop at Augmentation.

### Two loops, with different natures

| | ⑦ fails → ⑤ regenerate | gaps → ④ re-retrieve |
|---|---|---|
| Who decides to loop | **an `if` you wrote** | **the model decides for itself** |
| How many iterations | a cap you set | not known until runtime |
| What happens inside the loop | fixed: regenerate | the model chooses: what to look up, whether to look up anything at all |
| Type | **workflow retry** | **agent loop** |
| Priority | P1 | P2 |

**One-line test: is control flow decided at compile time, or at runtime?**

Note the two loops **jump back to different places**: the agent loop jumps back to
retrieve (it can fetch new material); the retry loop only jumps back to generate (it can
only rewrite).

### Why we're not doing multi-agent at this stage

> ⚠️ **"Not at this stage" does not mean "never."** But until the trigger conditions below
> appear, **don't pre-reserve an abstraction layer for it, don't design a "future
> extensible" interface, don't split apart a node that should stay cohesive.**
> Preparing early for this is exactly what this section is trying to prevent — it lets
> "we'll need it eventually anyway" justify complexity we don't need right now.

Multi-agent only has two legitimate justifications: **parallelism** (context bandwidth
isn't enough) and **isolation** (something must stay hidden). Concept questions need
neither:

- The material fits in a single context
- **There's no hidden answer** — coding questions have a reference solution that must be
  kept from the candidate, which is where "did the prompt leak the answer" / "is the
  prompt sufficient" questions came from. For concept questions, the answer is shown
  directly to the user — what's being tested is "can you articulate this yourself," not
  "can you guess what I've hidden"

> **The moment coding questions were cut, the system's only "must be isolated" scenario
> went with them.**

#### Trigger conditions for re-evaluating

Re-evaluate (**not "automatically start building" — bring it to the table for
discussion**) when any of the following signals appear:

```
□ A single request's retrieval material exceeds the context budget and must be sharded
□ One question needs material spanning 5+ patterns, and the merged token count overflows
□ A scenario appears where "one role must not see another role's output"
   (e.g., the difficulty rater must not see the reasoning behind why a question was written)
□ Serial batch jobs take an unacceptably long time (e.g. a full re-evaluation of the
   entire question bank)
□ Multiple expert perspectives are needed AND they need to pass intermediate conclusions
   between each other
   — note: if it's just "several perspectives each score independently, then aggregate,"
   that's an LLM-as-judge ensemble, not this
```

**Current status: none of these have appeared.**

#### Lighter-weight alternatives that already exist

Before the trigger conditions appear, these already cover most of the need:

| Need | Existing solution | Location |
|---|---|---|
| An independent judgment, uncontaminated by the generation context | **one isolated LLM call** | ⑦ verify entailment |
| A runtime decision about the next step | **agent loop** | gaps-driven re-retrieval (P2) |
| A comparison against "can't see the material" | **a one-way subagent** | cold reader (P3) |
| Reducing the variance of a single judgment | **LLM-as-judge ensemble** | judge calibration (P1) |

**The cold reader is the closest thing to multi-agent here** — it's given only the
scenario and option names, no retrieved material, and writes benefit/cost/when from
memory; comparing that output against the version with material: near-identical output
means the model already knew this without retrieval — **retrieval added no value**;
clearly different output means the question has real content. **It's doing eval, not
generation.**

It's an orchestrator-dispatched, one-way read-only subagent — it returns a result and
that's the end of it, no back-and-forth context passing with the main flow. This is the
shape the field converged on by 2026, **and it's also the first choice when isolation is
genuinely needed — ahead of full multi-agent collaboration.**

### A common source of confusion [important]

"Independent opinions from different perspectives" **is not multi-agent — it's an
LLM-as-judge ensemble**:

| | LLM-as-judge ensemble | multi-agent |
|---|---|---|
| Passes context between them | ❌ No | ✅ Yes |
| Mutually dependent | ❌ No — scores independently, then aggregates | ✅ Yes — one's output is another's input |
| Purpose | **variance reduction** | parallelism / isolation |

### Explicitly do not do

**Don't split "benefit agent + cost agent + when agent, each writing independently."**
These three must be mutually self-consistent (cost must target the same option, when must
not contradict the other two) — splitting them apart is a recipe for context
fragmentation and outputs that contradict each other.

---

## 7. The corpus

### 7.1 Current inventory [VALIDATED]

15 git sources fetched: 27,154 files → filtered down to 5,905 (keeping only `.md` /
`.mdx`). 5 web sources still to fetch: msio, fowler, aws-wa, sre, anthropic.

**Key finding: only one source, Azure, has a decision-relevant fixed template.**

structure-probe flagged 5 sources as "structured," but 4 of those are false positives:

| Source | Detected on | Is it actually a tradeoff section? |
|---|---|---|
| **azure** | Context and problem / Solution / When to use / Problems | ✅ **genuinely yes** |
| react | `Usage` / `Reference` | ❌ API-reference template |
| mdn | See also / Specifications | ❌ boilerplate |
| owasp | Introduction / References | ❌ boilerplate |
| mcp | Best practices / Security considerations | ⚠️ somewhat useful, but only 16 files |

> **Conclusion: structured ≠ has tradeoffs.**

**msio has been confirmed `Copyright © Chris Richardson, All rights reserved`,
`citable: false`.**
So in the first version, verbatim excerpts will be shown **only from azure**. msio is
still worth fetching — its structure is useful for **deciding which options to combine**,
it's just not shown as source text.

### 7.2 Buried gold worth including

While scanning structure-probe, a few templates turned up that weren't flagged as
"structured" but are high-value:

| Source | Template | Count | License |
|---|---|---|---|
| **aspnet** | Version introduced / Reason for change / Previous behavior / New behavior / Recommended action | **110 files** | CC-BY-4.0 ✅ |
| **aspnet** | Cause / Rule description / How to fix violations / **When to suppress warnings** | **56 files** | CC-BY-4.0 ✅ |
| efcore | Limitations | 9 | CC-BY-4.0 |
| mdn | Best practices / Accessibility concerns | 59 | CC-BY-SA |
| msplay | Code Review Checklist | 9 | CC-BY-4.0 |

"When to suppress warnings" is especially good — **"under what conditions is it OK to
break this rule" is a conditional judgment call in itself.**

**[OPEN]** should aspnet's two templates be included in v1? They're citable, high-volume,
and cleanly templated, but the questions they produce lean toward "specific technical
gotchas" rather than "architectural decisions," which might blur the product's
positioning.

### 7.3 Should clearly be cut

| Source | Reason |
|---|---|
| **openai**, 391 files | Titles are Japanese/Korean/Chinese translated versions, the same content repeated 4–5 times. English-only → ~80 files |
| **dotnet**, 2,089 files | 1,090 files have `See also` as their only section — these are API reference pages |
| **nextjs**, 451 files | `Version History` / `Returns` / `Parameters` = API reference |
| **react**, reference | `Usage` / `Reference` template = API reference; keep only `learn/` |
| **langgraph** | Most titles are the doc site's own contribution guide (Style guide / Adding pages) — **possibly the wrong directory was fetched, needs confirming** |

**Target: after a second pass filtered by path, bring the count down to 1,500–2,500
files.**

The reason isn't just storage: 8,000 files would chunk into roughly 50,000 sections, of
which maybe only 2,000 are useful. **The rest is noise, and vector search can't save you
from it — garbage in, garbage out.**

### 7.4 License tiering [DECIDED]

| License | Cache locally | Fed into prompt as reference | Verbatim shown | `citable` |
|---|---|---|---|---|
| CC-BY / MIT / Apache | ✅ | ✅ | ✅ | true |
| CC-BY-SA | ✅ | ✅ | ✅, with attribution noted | true |
| unknown / all rights reserved | ✅ | ✅ | ❌ external link only | **false** |

`citable: false` sources can still be used to decide what to question on and which
options to compare — they just don't display the source excerpt.
**You get the content value without it constituting redistribution.**

Set `citable` automatically based on license — don't judge it by hand each time.
`corpus/raw/` must be gitignored; the repo only commits manifests, section maps, and
reports.

### 7.5 Chunking spec [DECIDED, based on actual observation of the raw CQRS document]

**⚠️ Most important rule: chunking must go down to H3.**

The real heading hierarchy:

```
## Solution
   ### Separate read models and write models
   ### Benefits of CQRS                    ← the benefits live here, at H3
## Problems and considerations             ← costs, at H2
## When to use this pattern                ← applicability, at H2
## Combine the Event Sourcing and CQRS patterns
   ### Benefits of combining...            ← another benefit, at H3
   ### Considerations for how to combine   ← another cost, at H3
```

**If we only chunked on `##`, `Benefits of CQRS` would be buried inside a 3,000+ word `##
Solution` section and effectively lost.**

This explains the odd artifact in structure-probe where `Benefits` only showed up 6 times
— it's not that Microsoft doesn't write benefits, it's that most of them are at H3.

> 📌 **Lesson: the aggregate statistics encoded the assumptions of whoever wrote the
> query.** That report only counted H2 headings, which nearly caused the entire benefit
> dimension to be lost.
> Chunking rules must be based on actually observing the raw data, not assumptions about
> document structure.

Full spec:

```yaml
chunking:
  split on ## and ###
  do not split inside code fences ``` (a half code block is pure noise)
  when an H2 has H3 children, the H2 section keeps only the intro text
  before the first H3

kind matching (regex, case-insensitive — regex rather than exact lookup, because
headings have variants):
  cost:    ^(Problems|Issues|Considerations|Challenges|Limitations)
  benefit: ^Benefits
  when:    ^When to use
  example: ^(Example|Next step)
  meta:    ^(Workload design|Related resources|Contributors)

item-level chunking (a further split inside cost/benefit/when blocks):
  split on ^- \*\*(.+?)\.\*\* into standalone items, recording label + body
  reason: what a question needs is "one cost," not "the entire Problems section."
          More precise prompts, fewer tokens. This bold pattern is highly
          consistent across the azure corpus.

cleanup:
  strip directive lines like :::image::: / :::code:::
  keep link text, extract link targets into related[]   ← a free pattern relationship graph
  discard the entire Workload design section (Azure WAF cross-references, not tradeoffs)

contextual prefix:
  prepend each chunk with a source prefix, e.g. "[CQRS pattern / Problems and considerations]"
  ⚠️ the prefix is *concatenated*, not rewritten. The source text itself is untouched,
  so verbatim verification still works normally.
  Benefit: when a chunk lacks context on its own (the text doesn't contain the word
  "CQRS"), retrieval can still find it.

retain:
  the source text word-for-word (aside from the directive lines above)
  frontmatter's ms.date, stored as doc_date (for freshness judgments)
```

### 7.6 Why not "smart chunking" [DECIDED]

Semantic Chunking, Agentic Chunking, and similar methods **don't apply to structured
documents**:

1. **The source document is already chunked.** The author marked the boundaries explicitly
   with headings and bullets. Using an unreliable method to guess at a known answer is a
   net loss.
2. **Non-reproducibility would break verbatim verification.** LLM chunking can produce a
   different result each run → chunk boundaries drift → verification passes sometimes and
   fails other times. **This is a silent failure** that wouldn't surface until the
   question-generation stage.
3. **It loses the "why."** "I chunk along document structure because the source documents
   have stable templates; semantic methods only come into play for prose sources" carries
   far more weight than "I used a SemanticChunker."

### 7.7 What to do with prose sources [DECIDED direction]

fowler / sre / aws-wa are prose — tradeoffs are buried inside paragraphs, and table
lookups fail completely.

**The right approach: deterministic chunking + LLM does labeling only, never touches
boundaries.**

```
① Chunk by paragraph or a fixed token count          ← deterministic, reproducible
② LLM labels (never touches the source text):
     has_tradeoff: true/false
     kind: benefit | cost | when
     concept: which concept this involves
     verbatim_span: the key sentence extracted ← must be findable in the source text
                     verbatim; auto-verified at ingest time
③ Discard anything with has_tradeoff = false
④ kind_confidence marked 'llm'
```

**The key distinction: boundaries are fixed, the LLM only attaches labels.** Fixed
boundaries → reliable verification; mislabeled items are caught by spot-checking 20
samples; reruns produce consistent results.

For prose sources, **Contextual Retrieval prefixes pay off more than tweaking the chunking
itself** — the problem with prose isn't "where to cut it," it's "the cut piece doesn't
make sense on its own."

### 7.8 Coverage target [DECIDED]

**We are not targeting 100% — that target doesn't actually exist**, since there's no
denominator, it changes every day, and the product doesn't need it.

The right metric:

```
❌ Corpus coverage = concepts we have / all IT concepts        ← denominator doesn't exist
✅ JD satisfaction rate = concepts we can question on / concepts in this JD  ← computable,
                                                                    and dynamically weighted
```

**60–70% is entirely enough to ship.** The rest is explicitly listed as "identified, no
practice available yet" — that's honesty, not a defect, and that list doubles as the
fetch backlog.

The real denominator is smaller than it sounds: a JD has maybe twenty terms; after
filtering out `kind=tool` and pure API references, maybe twelve or thirteen actually
deserve a question.

**The goal isn't "cover everything," it's "always know what you haven't covered."**
That's the real purpose of `gaps`: **it's the mechanism that lets you ship confidently
while incomplete.**

Recommend preparing 5–10 real JDs as a satisfaction-rate benchmark.

---

## 8. Where vector search belongs [DECIDED, corrected]

### Only at resolve, not at retrieve

```
resolve:  "read-write separation at scale" → which concept?
          ⚠️ input is natural language, the alias table doesn't cover everything
          → needs vector search

retrieve: pattern_id = 'cqrs' → fetch its chunks
          ✅ input is the exact id resolve already produced → a table lookup is enough
```

**retrieve isn't fuzzy precisely because the two prior steps already dissolved the
ambiguity.** This is a deliberate architectural choice: concentrate ambiguity into a small
number of nodes and keep everything else deterministic. The payoff is fast debugging — if
a retrieval result is wrong, it's always resolve's or combine's fault.

> ⚠️ Note the distinction: **fuzzy ≠ needs vector search.**
> generate is the most ambiguous step in the whole pipeline, but that's "given the
> material in hand, how do I organize it" — a generation problem, not a retrieval problem.
> Vector search only resolves the ambiguity of "where is this thing."
>
> Also: today's retrieve is an **exhaustive fetch** (a pattern's costs are just those 3
> rows — take them all), not a filtering operation. Exhaustive fetch doesn't need a
> relevance judgment; filtering does.

### Map of ambiguity across the whole pipeline

| Step | Ambiguous? | Solution |
|---|---|---|
| extract | ⚠️ | LLM + evidence verification |
| resolve | ⚠️ | alias table + vector fallback + threshold |
| combine | ⚠️ slight | walk `related` edges (defined in the literature, no guessing) |
| **retrieve** | ✅ **not ambiguous** | SQL |
| generate | ⚠️⚠️ most ambiguous | prompt constraints + fact/form layer separation + gaps |
| verify | ✅→⚠️ | verbatim verification is a rule, entailment judgment is an LLM |

### Language scope [DECIDED, corrected]

- **extract / resolve's input is the JD, pure English** → no cross-language need
- **the cross-language need lives on the user-interaction side** (answering questions,
  conversational learning, material recommendations) → P3

So the embedding model choice can be simplified:

| | Original assumption (thought cross-language was needed) | Now (English only) |
|---|---|---|
| Model | had to be multilingual-aligned | **an English model is enough** |
| First choice | `text-embedding-3-large` | **`text-embedding-3-small` is enough** |
| Encoded text | concatenated Chinese+English aliases | **only English aliases + description** |

> ⚠️ `vector(1536)` locks in the embedding model — switching models means changing the
> column definition and recomputing the entire table.
> Different models' vector spaces are incompatible — computing similarity between a
> document encoded with A and a query encoded with B is pure noise.

### resolve's three-tier fallback [DECIDED]

```
① Exact alias match (after normalization)  → hit, confidence: high
② Vector search, top-3                     → similarity > threshold, confidence: medium
③ Neither works                            → unresolved, enters the gap queue
```

**② must have a threshold — it can't just be "the most similar one is it."** Without a
threshold, "Kafka" would get force-matched to some unrelated pattern — **that's a silent
error, worse than unresolved.**

### Threshold calibration method [DECIDED]

Don't guess. Calibrate automatically from two baselines:

```
Positive baseline: use a concept's own aliases as queries — the answer must be itself
                    → gives the similarity distribution for "definitely should match" →
                      take p10 as the lower bound
Negative baseline: use completely unrelated words
                    → gives the distribution for "definitely should not match" →
                      take p90 as the upper bound
Gray zone: choose conservative (call it unresolved) or aggressive (call it a match)
```

Fully automated, rerun once whenever the model changes. **This calibration process is
itself a complete AI-engineering story worth telling.**

### When retrieve would actually need vector search

Either of two conditions:

1. **A pattern has 50 cost items and only 5 fit** → this turns from exhaustive fetch into
   filtering, which needs semantic ranking
2. **A material-recommendation feature** → "give me material about eventual consistency"
   isn't a pattern name, it's scattered across multiple patterns — exact table lookup
   can't solve this

### Retrieval comparison experiment [suggested, P2]

Closes the knowledge gap on "retrieval optimization" — costs about two to three days:

```
Same corpus, same batch of queries (with human-annotated correct answers)
  A: tag-based exact lookup    B: pure vector    C: vector+BM25+RRF    D: C+rerank
Measure: recall@5, accuracy, latency, cost
```

The resulting narrative:

> "At my scale, tag lookup gets recall 0.94, pure vector gets 0.71 — because vector search
> pulls in a lot of vaguely-related passages. Hybrid + rerank gets to 0.88, but at 6x the
> latency. So v1 ships with tag lookup. That conclusion would flip once the corpus grows to
> thousands of entries, or once cross-pattern semantic queries are needed."

**This is stronger than "I used pgvector," and stronger than "I got 0.72 on BEIR" — it has
numbers, conditions, and a stated inflection point.**

resolve is the better place to run this experiment, because the evaluation criterion is
objective (is the concept_id right or not) — no LLM-as-judge required.

---

## 9. Three kinds of gaps and how to fill them [DECIDED]

### The unifying pattern

```
Automatic discovery  →  automatic candidate generation  →  👤 human admission  →  automatic execution
```

**The human is only in the "admission" slot, and it's always accept / reject, never data
entry.**

### ① Missing concept

```
JD says "Kafka" → both alias match and vector search miss → unresolved
```

| Step | Who does it |
|---|---|
| Gap queue accumulates it (kafka shows up 15 times) | automatic |
| Agent generates a candidate concept entry (id / aliases / kind / related / description) | automatic |
| **accept / reject / edit** | **👤 10 seconds** |
| Write into the concept table + compute the embedding | automatic |

**Why the human step can't be skipped** — `unresolved` mixes together three different
kinds of item, and only the first kind should be admitted:

```
kafka         → a genuine concept, admit it
Jira          → kind=tool, shouldn't be questioned on, don't admit it
"fast-paced"  → not a technical term at all → ⚠️ this is a signal of an extract bug
```

**A concept becomes useful the moment it's admitted, even with `has_corpus=false`**: it
goes from "I don't recognize this word" to "I know it, just haven't gathered material
yet" — a product-experience improvement at zero corpus cost.

### ② An entire pattern has no material (`has_corpus=false`)

```
Gap report ranks it → agent finds candidate sources → 👤 picks one → written into
sources.yaml → rerun ingest
```

Ingest is idempotent — `content_hash` skips files that haven't changed.

### ③ A specific `kind` is missing (more common, triggers `gaps`)

```
api-composition: benefit ✅  cost ❌  when ⚠️
```

Three responses, in increasing order of cost:

```
a) Degrade the question: drop this option, ask a two-option question    ← default
b) Trigger re-retrieval (agent), search that pattern's own page          ← P2
c) Accept the gap: some patterns genuinely have never had their costs
   systematically written up anywhere                                    ← an outcome to accept
```

### ④ Missing chunking rule (the most insidious case)

**The material was fetched, but the rule didn't recognize it.**

```
A new source's heading is "Benefits and drawbacks" (benefits and costs mixed in one
section)
→ matches the benefit regex
→ half the content is actually cost, misclassified
→ when the question is generated, a drawback gets cited as a benefit
```

**This kind of error doesn't throw, doesn't enter gaps, and silently poisons the
questions.**

Defense: at ingest time, emit an `unmapped` report (headings that don't match any `kind`
regex, plus their frequency) — scan it and decide whether to extend the regex, classify it
as mixed, or ignore it.

**For a `mixed`-kind section, have the LLM do item-level labeling** — judging bullet by
bullet whether it's benefit or cost.

### ⑤ Why we don't do "agent autonomously finds and ingests sources" [DECIDED]

Technically entirely feasible, but **don't do it**:

1. **Authority can't be judged automatically.** The entire product value proposition rests
   on "traceable to authoritative documentation." Letting an agent decide "is this blog
   authoritative" hands the single most critical quality gate to a component that will
   fail silently. A well-written Medium post can be entirely wrong; msio's value comes
   from Chris Richardson the person, not the prose style. **This is a social judgment,
   not something a model can make.**
2. **License issues are a real legal problem.** The msio case is a live example — one line
   in the footer, "All rights reserved," only noticed on a manual look.
3. **The payoff is extremely low.** Adding a source = five lines in a yaml file, done two
   or three times a month. **Automating something low-frequency, low-effort, and
   high-risk is a net negative.**

**Middle-ground option (P3, could be a project highlight)**: the agent does candidate
discovery, the human does admission.

```
Input: "kafka" (from the gap queue)
Agent: multi-round search → for each candidate, output URL / organization / license /
       how structured it is / whether it has a tradeoff section
       a domain allowlist filters out most of the noise up front
Output: a candidate list → 👤 one click → automatically appended to sources.yaml →
        rerun
```

**This is a real agent** (multi-round, evaluative, indeterminate step count), but the
admission decision stays with the human.

### What should be automatic is "knowing what needs filling in"

```
Weekly CI output:

JD satisfaction rate (50-JD benchmark): 71%

Top 5 gaps (ranked by degraded_count)
  kafka           47 degradations   concept known, no material
  grpc            11 degradations   concept known, no material
  feature-flag     9 degradations   not recognized yet, needs a concept first

Pattern material completeness
  cqrs             benefit ✅ cost ✅ when ✅
  api-composition  benefit ✅ cost ❌ when ⚠️  ← will trigger gaps at question time
```

**Ranking by `degraded_count` is more accurate than ranking by raw JD-mention
frequency** — it measures how many actual degradations something caused.

---

## 10. Ungrounded degradation [DECIDED, P2]

When a `concept` exists but its `doc_chunk` doesn't, the system isn't limited to showing
"no practice available" — it can present a question **explicitly labeled as unsourced**.

### Three tiers of trustworthiness

| Tier | Condition | Displayed as |
|---|---|---|
| `grounded` | has authoritative source text + verbatim | rendered normally, each claim expandable to its source |
| `ungrounded` | purely LLM-generated | **reduced visual weight + collapsed by default + explicit warning** |
| `unavailable` | not even a concept exists | "identified, no practice available yet" |

### Three non-negotiable guardrails

**① The visual treatment must be unmistakably different, not just a small caption.**
If the two question types look the same, users will stop noticing the label within three
minutes and default to trusting everything — which defeats the entire sourcing mechanism.
**Collapsed by default** matters especially: it makes "backed by authoritative material"
the default experience, with ungrounded content as something the user actively expands
into.

**② The wording must name the specific risk.**

```
⚠️ Unsourced content

This question was generated directly by the model; we haven't yet collected authoritative
documentation on this topic. The content may include outdated or incorrect technical
judgments, and its source cannot be verified. Recommend cross-checking against official
documentation before using it as a learning basis.
```

"**Cannot be verified**" is the key phrase — it accurately names what's actually missing.

**③ Must be filtered by `kind`, or ungrounded degradation turns into a garbage catch-all.**

```
Only kind ∈ {architecture, practice} AND the concept is already in the database may be
allowed to degrade to ungrounded.
```

Otherwise users would see something like "an architectural-decision question about Jira."

### Suggested added field: model self-assessment

```json
{
  "grounding": "ungrounded",
  "self_assessment": {
    "confidence": "medium",
    "volatility": "high",
    "note": "This area has changed quickly over the past couple of years; the
             following judgment may be out of date"
  }
}
```

**`volatility` is especially useful**: SOLID principles have low volatility (the model's
memory is reliable); service-mesh choices have high volatility (best practice from two
years ago may have reversed by now).

**High-volatility items can be filtered a second time — not even shown as ungrounded,
straight to unavailable.**
Because ungrounded's real risk isn't "no source," it's "the content might be wrong."

---

## 11. Priorities [DECIDED]

### P0 — without this, the system doesn't exist

```
Offline: fetch → chunk → kind-classify → corpus tables
Online:  extract → resolve (alias exact match) → combine → retrieve
         → generate → verify verbatim → display
```

**11 nodes, no agent, no vector search, no evals.** This is two-to-three weeks of work.

Three engineering conventions must also be in place from the start (zero cost, see §4.5):
- All LLM calls collapsed into a single `llm.py`; business code never imports the provider
  SDK directly
- Model names are configuration, not hardcoded
- Inputs/outputs defined with Pydantic

### P1 — without this, it isn't trustworthy

- verify entailment (an independent LLM call)
- **resolve's vector fallback** (English, `text-embedding-3-small` + calibrated threshold)
- The gap queue (no UI needed, just a log — the earlier it starts accumulating, the better)
- The `related` relationship graph (comes almost free from extracting links during
  chunking)
- A gold set of 20–30 items + a judge-calibration set of 10–15 items

### P2 — only once a trigger condition appears

- gaps-driven re-retrieval (agent loop)
- Ungrounded-degradation display
- CI regression
- The retrieval comparison experiment (A/B/C/D)

### P3 — needs real data first

- Cold reader (an isolated subagent)
- Answer diagnostics / weak-point attribution
- Material recommendation (this is where doc_chunk's vector column finally earns its keep)
- Cross-language support (user-interaction side)
- Agent-driven candidate source discovery

### Ordering principle

The only question that matters: **would changing this invalidate work that's already
done?**

| Asset | Would invalidate existing work? |
|---|---|
| `concept_id` naming | ✅ **severely** (breaks the `doc_chunk` foreign key + every historical answer's label) |
| The data model | ✅ |
| The ruler (gold set) | ✅ (without it, there's no way to judge whether a change is an improvement) |
| The document corpus | ❌ only grows, never shrinks |
| Gap detection | ❌ |

**The ruler sits at P1, not P0**, because labeling it needs real system output first — you
have to see what the system actually generates before you can build the yardstick. But it
must exist **before heavy prompt tuning begins**, or twenty rounds of tuning happen with
no way to tell which direction is actually an improvement.

> **The most common failure mode**: spending two weeks on corpus-building without ever
> running the full pipeline end to end once — only to discover, once it finally runs, that
> the carefully designed format doesn't fit real usage, and it all has to be redone.
> **Get it running first, then make it good.**

---

## 12. Non-negotiable hard constraints

Violating any of these causes damage that is silent and hard to discover after the fact.

1. **Source text must never be paraphrased, cleaned up, or summarized by an LLM.**
   Verbatim verification depends on exact matches against the original text — any
   rewriting makes sourcing silently fail, and it won't surface until the
   question-generation stage. **No exceptions to this one.**
2. **A `concept_id`, once in the database, may never be renamed.** Only add a new one +
   mark the old one `deprecated`.
3. **`includes()` verification alone is insufficient — an independent entailment judgment
   is required.** Experiment 1 proved it: a citation can genuinely exist in the source and
   still fail to support the claim, while a substring check would pass it anyway.
4. **The entailment check's input must be isolated** — give it only `claim` and
   `verbatim`, never the generation trail. There's no value in having the author judge
   whether their own work is correct.
5. **Never split benefit / cost / when into separately-written pieces.** All three must be
   mutually self-consistent — splitting them apart manufactures contradictions.
6. **Vector matching must have a threshold.** No threshold = a silent error, which is worse
   than `unresolved`.
7. **Corpus admission is a human decision, not an engineering operation.** The LLM may
   generate candidates, process metadata, and propose judgments — but it must never touch
   the source text, and it must never make the admission call.

### The principle running through all of these

> **The LLM may process metadata, generate candidates, and propose judgments;**
> **but it must never touch the source text, and it must never make an admission
> decision.**

---

## 13. Open decision points

| # | Decision | Impact |
|---|---|---|
| 1 | Whether to include aspnet's breaking-change / code-analysis templates in v1 | Adds a "specific technical gotcha" question type, which may blur the product's positioning |
| 2 | The exact criteria for the second-pass path filtering (by directory vs. by tradeoff-keyword density) | Corpus density |
| 3 | Whether langgraph was fetched from the wrong directory (most titles are the doc site's own contribution guide) | Needs confirming |
| 4 | The complete field set for EXTRACT's output schema (both Pydantic and Zod sides) | **Blocks resolve and generate** |
| 5 | The unified `Item` data model's fields | **Blocks all of P0** |
| 6 | Whether RESOLVE lives as an internal NestJS endpoint (called back into by Python) or is resolved up front and passed to Python | Shape of the service contract |

**4 and 5 block the start of work — resolve these first.**

---

## 14. Constitution impact

Per Principle III, the following are structural changes and **must go through the full
spec → plan → tasks → implement flow**:

- Database schema (the concept table, the doc_chunk table, vector columns, answer-attempt
  records)
- LangGraph topology (splitting extract/resolve, the generation graph, the P2 agent loop)
- Service boundary (`POST /internal/retrieval/search`, the Python → NestJS callback
  direction)

**Requires a constitutional amendment**: removing Judge0 (scope reduction — code execution
is no longer needed).

**Does not require an amendment**: NestJS owning the vector tables and retrieval layer —
this is already consistent with Principle IV.

---

## 15. How to evaluate a new feature

The point of this section is to give "adding something new" a stable basis for judgment,
**so this document doesn't need a major rewrite every time**. When adding a feature, work
through these five questions in order and record the answers in that feature's spec.

### Question 1: which layer does it belong to?

```
Layer 3, content sources (question types, corpus sources)       → adding content,
                                                                    doesn't touch architecture
Layer 2, the generation pipeline (retrieval, generation,
verification)                                                    → pluggable, localized change
Layer 1, the diagnostic/assessment core (concept graph, answer
records, quality metrics)                            → ⚠️ can invalidate existing data
```

**Changing layer 1 requires extreme caution**, especially `concept_id` and the data model
(see §12, item 2).

### Question 2: does it need an LLM?

By the standard in §4.2: **does this have a single correct answer that rules could
express?**

If it can be expressed as a rule, don't use an LLM — deterministic components are easier
to test, easier to debug, and cheaper. The current pipeline makes only 3 LLM calls; new
features shouldn't casually break that ratio.

### Question 3: where does the ambiguity live?

Refer to §8's ambiguity map. Ambiguity introduced by a new feature should **stay
concentrated in a small number of nodes**, not spread out.

- Input is natural language → may need vector search (first ask how the threshold would
  be calibrated)
- Input is a system-generated id → table lookup, don't reach for vector search

### Question 4: would it break verbatim sourcing?

**This is the question most likely to be overlooked, and the one with the most insidious
consequences.**

```
□ Does it rewrite, clean up, or regenerate any source text in any way?
  → violates §12 item 1, forbidden
□ Does it change chunk boundaries or chunk_ids?
  → would break sourcing on every question that already exists
□ Does it introduce a new form of citation without a corresponding verification step?
  → verification must be designed alongside it
```

### Question 5: has its trigger condition actually been met?

Several places in this document say "not doing this yet," each with an explicit trigger
condition written down — **don't pre-build for it just because "we'll need it eventually
anyway."**

| Deferred item | Trigger condition is in |
|---|---|
| multi-agent | §6 |
| a vector column on the retrieve side | §8 |
| LangChain | §4.5 |
| cross-language support | §8 |
| prose-source processing | §7.7 |
| agent-driven source discovery | §9 ⑤ |

**A trigger condition appearing means "bring it to the table for discussion," not
"automatically start building."**

### A fallback principle

> If a new feature simultaneously satisfies "doesn't touch layer 1," "doesn't add a new
> LLM call," and "doesn't touch the source text," it's very likely a safe incremental
> addition — go ahead.
> **If it breaks any one of the three, write a spec first, and answer the five questions
> above inside that spec.**

---

## 16. Completed outputs

- `concepts.v0.yaml` — a 20-node concept-graph draft. **⚠️ That draft was selected under a
  "BCL-only + executable" criterion, and became obsolete along with the pivot away from
  coding questions.** But its **structure** (a two-layer tree + DAG, `failure_signals`,
  `aliases`, an `out_of_scope` list) is still valid — the new concept table can reuse this
  schema and just swap in new content, which should now lean toward architecture- and
  engineering-level concepts (i.e., the batch that was previously in `out_of_scope_v0`).
- 15 git sources fetched and filtered (5,905 md/mdx files)
- `structure-probe.md` — heading-frequency statistics for the git sources
- The complete input/output logs from both generation experiments
