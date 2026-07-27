# Quickstart: JD Structured Extraction and Candidate Training Direction Recommendation

## Prerequisites

- Node.js 20 LTS, with `npm install` already run (pulling in Fastify /
  `@langchain/langgraph` / `openai` / `zod` / `drizzle-orm` + `drizzle-kit` / `jest` +
  `ts-jest`, all confirmed in plan.md's "Complexity Tracking")
- A local or reachable PostgreSQL instance, with the `pgvector` extension enabled (even
  though this feature doesn't use vector columns, the extension needs to already exist
  to match the project's unified database configuration)
- Environment variables:
  - `OPENAI_API_KEY`: for connecting directly to the OpenAI SDK (Constitution IV, no
    gateway at the current stage)
  - `DATABASE_URL`: points to the Postgres instance above, and is also read by
    `drizzle.config.ts`

## Startup Steps

```bash
npm install
npm run db:generate  # drizzle-kit generate: generates a migration from src/db/schema.ts
npm run db:migrate   # drizzle-kit migrate: runs the migration against DATABASE_URL
npm run dev          # start the Fastify dev server
```

## Validation Scenarios (corresponding to the spec's three Acceptance Scenarios)

### Scenario 1: A JD with complete information → returns a structured summary + 3-6 directions

```bash
curl -X POST http://localhost:3000/jd-submissions \
  -H "Content-Type: application/json" \
  -d '{"text": "We are hiring a Senior Backend Engineer, proficient in Node.js, TypeScript, and PostgreSQL,\nfamiliar with distributed systems design; experience with Kafka or a similar message queue is a plus."}'
```

**Expected**: HTTP 201; response body `status = "accepted"`; `extraction.role` contains
wording related to "Backend Engineer"; `extraction.techStack` includes Node.js /
TypeScript / PostgreSQL; `extraction.seniority` is "Senior" with `seniorityInferred =
false` (explicitly stated in the original text); `directions` has a length between [3,
6], and each item has a non-empty `rationale` (with keywords from the rationale
findable in the request body's `text`), non-empty `tags`, and `suggestedQuestionCount >
0`. See the `JdSubmissionAccepted` schema in
[contracts/openapi.yaml](./contracts/openapi.yaml).

### Scenario 2: Manual check of rationale traceability (corresponds to SC-002)

For each `directions[i].rationale` returned in Scenario 1, manually confirm that the
technical points or phrases it quotes/paraphrases genuinely appear in the submitted JD
original text, rather than being fabricated by the model. In automated tests, this is
asserted in `tests/integration/jdSubmissionFlow.test.ts` using a fixed JD text + a mocked
LLM response (the mocked response itself is hand-constructed in the test to ensure
coverage of the shape constraint "rationale quotes the original text"; spot-checking the
quality of real LLM output is a manual QA responsibility and is out of scope for
automated tests).

### Scenario 3: A JD with an extremely rich tech stack → the direction count does not exceed 6

```bash
curl -X POST http://localhost:3000/jd-submissions \
  -H "Content-Type: application/json" \
  -d '{"text": "<a long JD covering tech stacks across multiple directions such as frontend/backend/data/DevOps/algorithms>"}'
```

**Expected**: The `directions` array's length ≤ 6, even if the JD content could map to
far more than 6 directions.

## Boundary Scenario Validation

- **JD text too short / clearly not a job description**: submit `{"text":
  "asdkjaskjd"}`, expect HTTP 422, `status = "rejected"`, `reason` prompting for more
  complete JD content (FR-011).
- **No explicit seniority mentioned**: submit a JD that contains no seniority wording,
  expect `seniorityInferred = true` with `seniority` still holding an inferred value
  (FR-010).
- **Sparse tech stack, insufficient to support 3 directions**: submit a short JD that
  mentions only one or two technologies, expect `status = "accepted"` but a `directions`
  length < 3 (rather than an error, and rather than being padded up to 3, FR-012).

## Unit/Integration Test Entry Points

```bash
npm run test          # runs tests/unit + tests/contract + tests/integration (Jest)
npm run typecheck
npm run lint
```

- `tests/unit/graph/*`: each LangGraph node tested independently, mocking the `openai`
  client and the Drizzle client (Constitution II).
- `tests/contract/jdSubmissions.contract.test.ts`: uses Fastify's `inject()` to verify
  the request/response shape matches `contracts/openapi.yaml`.
- `tests/integration/jdSubmissionFlow.test.ts`: runs the full state graph (LLM/DB both
  mocked), covering the 3 Acceptance Scenarios and 3 boundary scenarios listed above.
