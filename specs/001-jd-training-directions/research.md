# Phase 0 Research: JD Structured Extraction and Candidate Training Direction Recommendation

## 1. LLM structured output mechanism

**Decision**: Use `zodResponseFormat`, built into the official OpenAI `openai` npm SDK
(located at `openai/helpers/zod`), to directly convert an existing Zod schema into the
JSON schema required by Structured Outputs and pass it to `chat.completions.parse(...)`;
after getting the response, run the same Zod schema's `.parse()` once more against
`message.parsed` / the raw JSON, and only write it into graph state after this double
safeguard.

**Rationale**: `zodResponseFormat` is a helper built into the `openai` SDK itself, so
there's no need to separately install a third-party conversion library such as
`zod-to-json-schema`; this naturally satisfies Constitution I ("LLM structured output
must have a corresponding Zod schema; raw, unvalidated output must not be used downstream
directly") without adding any dependency outside the list.

**Alternatives considered**:
- Hand-writing a JSON schema and separately maintaining a corresponding Zod schema: the
  two schemas would easily drift apart, and there's no need for this since the SDK
  already provides a path generated from Zod.
- Using function calling / tool calls instead of `response_format`: the effect is
  equivalent, but Structured Outputs (`response_format: {type: "json_schema", strict:
  true}`) gives a stronger guarantee on "must strictly match the schema", which fits
  better with the acceptance criteria that "rationales must be traceable and fields must
  be complete".

## 2. Postgres client

**Decision**: Use `drizzle-orm` (at runtime, based on the `node-postgres` driver) +
`drizzle-kit` (a dev-time schema/migration tool), rather than hand-writing SQL against a
bare driver.

**Rationale**: Purely from an implementation-complexity standpoint, a scope of two
tables and one transactional write could be handled more simply with the bare `pg`
driver; but this is a job-hunting/learning project, and the user explicitly wants to use
it as a chance to practice schema-as-code, a type-safe query builder, and a migration
workflow — a skill set that is more commonly mentioned in today's hiring market — so
Drizzle was adopted. A `schema.ts` is defined in TS; when the table structure changes,
the TS types used in queries stay in sync automatically; `drizzle-kit` is responsible for
generating/running migrations, so there's no need to hand-write SQL migration files.

**Alternatives considered**:
- Bare `pg` driver: simpler to implement, fewer dependencies, the "minimal implementation
  path" choice — but it doesn't satisfy the user's learning goal of practicing an ORM
  workflow through this project, so it was not adopted.
- Prisma: also provides schema-as-code and migrations, but requires a separate codegen
  step and a runtime engine, making the pipeline heavier than Drizzle's; Drizzle is
  closer to a "thin wrapper + directly maps to SQL" style, which is closer to the
  project's overall leaning toward "don't introduce unnecessary abstraction".

**Confirmed with the user**: Drizzle was selected.

## 3. Test framework

**Decision**: Use Jest (a pure-ESM project needs to pair this with `ts-jest`'s ESM
preset, or the equivalent `NODE_OPTIONS=--experimental-vm-modules` setup).

**Rationale**: Purely from the standpoint of "zero configuration for a pure ESM + TS
project", Vitest is more convenient; but from a job-hunting/learning perspective, the
user considers Jest's ecosystem the most mature and its recognition among employers the
highest — a "safer" default answer when asked in an interview "what testing framework do
you use" — so Jest was chosen, accepting the extra ESM transpilation configuration cost;
that configuration cost is itself worth going through once in a learning project.

**Alternatives considered**:
- Vitest: zero configuration and faster execution for the current pure-ESM tech stack,
  with a mock/spy API highly compatible with Jest's — a more "frictionless" technical
  choice, but with lower recognition/familiarity in the hiring market than Jest, so it
  was not adopted.
- Node's built-in `node:test`: lightweight enough, but its ecosystem plugins (coverage,
  mocking capability, etc.) and hiring-market recognition both fall short of Jest's.

**Confirmed with the user**: Jest + `ts-jest` (ESM preset) was selected.

## 4. Shape of the LangGraph state graph

**Decision**: A single state graph with 4 stages:
1. `extractJdStructure` (node): a single LLM call, outputting `{role, techStack[],
   seniority, seniorityInferred, sufficient, insufficientReason?}` — the sufficiency
   judgment (FR-011) is directly a field of the extraction result, given by that same LLM
   call, rather than an extra layer of heuristic rules bolted on.
2. Conditional edge: `sufficient === false` → goes directly to the `rejectInput`
   terminal node, returning the rejection message required by FR-011, without spending a
   second LLM call.
3. `generateCandidateDirections` (node): a second LLM call, taking the structured
   extraction result + **the full JD original text** as input (a summary alone is not
   enough, otherwise the rationale can't be traced back to the original wording,
   violating FR-006), outputting 0-6 candidate directions (fewer than 3 allowed, more
   than 6 not allowed, FR-005/FR-012).
4. `persistSubmission` (node): writes the JD submission record + the candidate-direction
   list within a single database transaction (FR-013), and returns the result to the
   routing layer for the response.

**Rationale**: Each node has a single responsibility and can be independently mocked and
tested for LLM/DB (Constitution II); building the "sufficiency" judgment into the
extraction node avoids creating a separate node or an extra LLM call for a single boolean
field, in keeping with the principle of "don't design for hypothetical complexity".

**Alternatives considered**:
- Doing extraction + direction generation in a single LLM call: saves one round trip,
  but would couple both the "reject when information is insufficient" branch and the
  "return <3 directions when information is sufficient but sparse" branch into a single
  generation step, making both testing and the prompt harder to maintain; splitting them
  apart gives each failure mode (rejection vs. insufficient count) a clearer boundary.
- Using a separate rule engine to judge "sufficiency": the language/structure of JD text
  varies too widely for a rule engine to generalize well, and it would introduce a new
  component outside the list; leaving the judgment to the LLM within the same extraction
  call is simpler and more reliable.

## 5. Boundary handling for the lower bound on the number of candidate directions

**Decision**: Follow the default judgment call already made in the spec's existing
Assumptions section — once FR-011 determines that "information is sufficient" (i.e.,
role/tech-stack can be identified), the `generateCandidateDirections` node returns at
least 1 direction; a count of 0 directions should only occur on the branch where FR-011
directly rejects the input, and there should be no intermediate state of "sufficient but
unable to generate even a single direction".

**Rationale**: The spec's Assumptions section has already addressed this ambiguous point
and noted that it "can be adjusted via `/speckit-clarify` if it doesn't match actual
intent"; this does not reintroduce a new open question — it simply makes explicit, at
the implementation level, that "sufficiency judgment" and "lower bound on count" are two
sides of the same threshold, avoiding an unclassifiable third state in the graph.

**Alternatives considered**: None — this is the technical realization of an assumption
the spec already makes, not a new design-decision branch.
