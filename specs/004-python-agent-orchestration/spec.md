# Feature Specification: Python Agent Orchestration Service (FastAPI + LangGraph + LangChain)

**Feature Branch**: `scrum-41-python-agent-orchestration`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "Implement the Python FastAPI + LangGraph + LangChain agent
orchestration service, in a new top-level directory in this same repo. It exposes
POST /extract per the already-authored contract at
specs/003-jd-extraction-nestjs-integration/contracts/agent-orchestration.yaml... Priority
for this pass is proving the full technical pipeline actually works end-to-end — prompt
quality and extraction accuracy are explicitly deferred to future iteration, not part of
this feature's acceptance bar."

## Background

Constitution v2.1.0 locks the agent orchestration service to Python + FastAPI +
LangGraph + LangChain. This service has been a documented gap since SCRUM-38/39: the
NestJS API service (SCRUM-39) already implemented a client against a contract
(`specs/003-jd-extraction-nestjs-integration/contracts/agent-orchestration.yaml`) that
this service must satisfy — but no code has existed to fulfill that contract, so every
real request the NestJS side makes currently fails with an upstream error (`502`). This
is the first Python code in the project, and the piece that makes the end-to-end
JD-submission pipeline work for the first time.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fulfill the agent orchestration contract for the NestJS service (Priority: P1)

As the NestJS API/persistence service (the sole caller of this service), I submit JD
text to the agent orchestration service and receive back either a structured extraction
with candidate training directions, or a clear insufficient-information rejection, so
that the end-to-end JD-to-training-directions pipeline can complete for the first time
since the architecture pivot.

**Why this priority**: This is the one remaining piece blocking the whole pipeline —
without it, SCRUM-39's NestJS endpoint can never return anything but an upstream-failure
response, no matter how correct its own code is. It is the entire scope of this feature.

**Independent Test**: Send a JD text with a clear role/tech-stack/seniority to
`POST /extract` and confirm a well-formed "sufficient" response comes back, with a
structured extraction and 0-6 candidate directions in the documented shape. Send a
clearly insufficient text (e.g. a single unrelated sentence) and confirm a well-formed
"insufficient" response comes back instead — both verifiable without needing the NestJS
service at all, since this feature's own contract is the unit under test.

**Acceptance Scenarios**:

1. **Given** JD text with a clear role, tech-stack, and seniority, **When**
   `POST /extract` is called, **Then** the response reports the submission as sufficient,
   with the extracted role/tech-stack/seniority/seniority-inferred flag filled in and 0-6
   candidate directions, each with a name, rationale, tags, and suggested question count,
   in the exact shape documented in `contracts/agent-orchestration.yaml`.
2. **Given** JD text that doesn't contain identifiable role or tech-stack information,
   **When** `POST /extract` is called, **Then** the response reports the submission as
   insufficient, with a reason, and no candidate directions are generated.
3. **Given** a request body missing or with an empty `text` field, **When**
   `POST /extract` is called, **Then** the request is rejected before any LLM call is
   attempted.
4. **Given** the underlying LLM call fails, times out, or returns a response that
   doesn't conform to the expected shape, **When** `POST /extract` is called, **Then**
   the service returns a clear error response rather than hanging, crashing silently, or
   passing malformed data through as if it were valid.

---

### Edge Cases

- Very short or garbled JD text is expected to be handled by the insufficient-information
  path (Acceptance Scenario 2), not a special error case.
- An LLM response that violates the expected shape (e.g. missing a required field, more
  than 6 directions) is treated as an internal failure (Acceptance Scenario 4) — it MUST
  NOT be silently truncated, coerced, or passed through partially valid.
- What happens if the LLM call itself is slow — this service's own response time budget
  is bounded well under the 30-second timeout the NestJS caller already enforces on its
  side (see SC-001), so a slow-but-eventually-successful call and a call that exceeds
  that budget are both real, expected paths to handle, not edge cases to ignore.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept a JSON `POST` request at `/extract` containing
  free-form JD text.
- **FR-002**: The system MUST extract role, tech stack, and seniority (explicitly stated
  or inferred) from the JD text via an LLM call.
- **FR-003**: When the extracted information is sufficient to identify a role and tech
  stack, the system MUST generate 0-6 candidate training directions — each with a name,
  rationale, tags, and a suggested question count — via a second LLM call informed by
  the full original JD text (not a summary).
- **FR-004**: When information is insufficient, the system MUST return a rejection
  response with a reason, without attempting to generate candidate directions.
- **FR-005**: All LLM output MUST be validated against a schema before being included in
  the HTTP response; output that fails validation MUST result in an error response, never
  a partially valid or unvalidated pass-through (constitution Principle I).
- **FR-006**: The response shape, for both the sufficient and insufficient cases, MUST
  exactly match the contract already documented at
  `specs/003-jd-extraction-nestjs-integration/contracts/agent-orchestration.yaml` — this
  feature implements an existing contract, it does not define a new one.
- **FR-007**: The system MUST reject a malformed request (missing or empty `text` field)
  before attempting any LLM call.

### Key Entities

None — this service is stateless. It does not persist anything; the NestJS API service
(specs/002, specs/003) already owns all persistence for this pipeline.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A well-formed request with a successful underlying LLM call receives a
  schema-valid response within 25 seconds (leaving margin under the NestJS caller's
  existing 30-second timeout).
- **SC-002**: 100% of requests with clearly insufficient JD text receive a well-formed
  "insufficient" response (not an error).
- **SC-003**: 100% of responses conform exactly to the documented contract shape — no
  missing or extra required fields, direction count always within 0-6.
- **SC-004**: The full pipeline completes end-to-end at least once: a JD text submitted
  through the NestJS service reaches this service, gets a real LLM-backed response, and
  results in a persisted `JdSubmission` (and, for the sufficient case,
  `CandidateTrainingDirection` rows) in Postgres — proving every layer of the
  architecture pivot actually connects, which has not been demonstrated before this
  feature.

## Assumptions

- **Extraction/generation quality is explicitly out of scope for this feature's
  acceptance bar.** The goal is proving the technical pipeline (FastAPI + LangGraph +
  LangChain + LangSmith + the already-defined HTTP contract) works end-to-end — not
  tuning prompt quality or extraction accuracy, which is deliberately deferred to future
  iteration per explicit user direction. Acceptance scenarios test *shape and behavior*
  (sufficient vs. insufficient, schema conformance, error handling), not *judgment
  quality* of what the LLM extracts or recommends.
- OpenAI is the LLM provider for this pass, matching the project's existing default;
  Bedrock remains a documented future option, not built now.
- This service is stateless by design — no database, no persistence — matching the
  architecture already established (NestJS owns persistence).
- The underlying graph shape (two LLM-calling stages with a conditional branch on
  whether information is sufficient) mirrors the design already agreed in
  `specs/001-jd-training-directions/research.md` §4 before the stack pivot — this
  feature translates that design to the new stack, it does not reopen it as a new
  design decision.
- LangSmith tracing is enabled per explicit user choice (discussed during the
  constitution v2.1.0 amendment) — it requires a LangSmith API key configured in the
  environment. If unavailable (e.g. no key set in a given environment), tracing MUST
  fail open (the core pipeline keeps working without traces) rather than fail closed
  (blocking requests because tracing couldn't be set up) — tracing is an observability
  aid, not a correctness dependency.
