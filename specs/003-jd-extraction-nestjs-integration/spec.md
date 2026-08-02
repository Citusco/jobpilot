# Feature Specification: JD Structured Extraction and Candidate Training Direction Recommendation (NestJS Integration)

**Feature Branch**: `scrum-39-jd-extraction-nestjs-integration`

**Created**: 2026-08-02

**Status**: Draft

**Input**: User description: "SCRUM-39 — re-plan and implement the original JD-extraction/candidate-direction-generation business flow (originally specs/001-jd-training-directions) on top of the new NestJS + Prisma foundation (SCRUM-38), calling out to the separate Python agent-orchestration service across the documented service boundary (constitution v2.0.0, Principle IV)."

## Background

specs/001-jd-training-directions defined this feature's business scope under the
pre-v2.0.0 stack (Fastify + Drizzle + Node-side LangGraph). The business goal is
unchanged; this spec re-expresses the same user-facing behavior for the current
architecture, where the actual extraction/generation logic runs in a separate Python
FastAPI + LangGraph agent-orchestration service, reached over an explicit HTTP
interface (constitution Principle IV), not in-process.

**Known constraint at the time this spec was written**: the Python agent-orchestration
service does not exist yet — it has not been filed as a Jira Story or implemented. This
feature defines the HTTP contract that service is expected to satisfy (see
contracts/agent-orchestration.yaml) and implements the NestJS side of the integration
against that contract. The outbound call is real code, not a stub, but it cannot
succeed end-to-end until the Python service is built and deployed — see Assumptions and
the Independent Test note below for what can and cannot be verified right now.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Extract JD structural information and generate candidate training directions (Priority: P1)

As a user responsible for designing live-coding training content for a given position, I
paste in a real Job Description text, and the system parses out structured information
such as role, tech stack, and seniority, and based on that information gives 3-6
candidate training directions; each direction states its recommendation rationale
(traceable back to the JD text), carries tags, and gives a suggested question count, so
that I can pick a direction based on this and decide whether to move on to question
generation next.

**Why this priority**: This is the first link in the entire training-content generation
pipeline — without reliable structured extraction and direction recommendation, none of
the downstream steps (question generation, paper assembly) can begin. It is the only
user story in scope and the entire content of this feature's MVP, same as in the
original specs/001-jd-training-directions.

**Independent Test**: Once the Python agent-orchestration service is deployed and
reachable, this can be verified exactly as in the original spec — paste a real JD text
and check that the returned role/tech-stack/seniority summary is consistent with the JD
content, and that the generated directions each include a traceable rationale + tags +
suggested question count. Until then, this feature's NestJS-side pieces are
independently verifiable in isolation: request validation, response-contract validation,
persistence, and error handling when the agent service is unreachable — all covered by
automated tests that mock the agent-service HTTP call (see quickstart.md).

**Acceptance Scenarios**:

1. **Given** a JD text containing a clear role, a tech-stack list, and a seniority
   description, **When** it is submitted, **Then** the system calls the agent
   orchestration service, persists the returned structured summary and candidate
   directions, and returns a `201` response with the summary and 3-6 candidate training
   directions (fewer if the agent service reports the tech stack as sparse — see
   Assumptions), each carrying a rationale, at least one tag, and a suggested question
   count.
2. **Given** a JD the agent orchestration service reports as insufficient to identify a
   role or tech stack, **When** it is submitted, **Then** the system persists the
   submission as rejected and returns a `422` response with a rejection reason, without
   generating candidate directions.
3. **Given** the agent orchestration service is unreachable or returns an error,
   **When** a JD is submitted, **Then** the system returns a `502` response indicating an
   upstream failure, and does NOT persist a submission record (there is no valid
   extraction result to persist).
4. **Given** a request body that is missing the `text` field or has an empty string,
   **When** it is submitted, **Then** the system returns a `400` response without calling
   the agent orchestration service.

---

### Edge Cases

- What happens when the JD text is too short, or is clearly not a job description? —
  Delegated to the agent orchestration service's own judgment (FR-011-equivalent),
  surfaced to the caller as the `422` rejection path (Acceptance Scenario 2).
- What happens when the agent orchestration service times out rather than erroring or
  responding? — Treated the same as unreachable (Acceptance Scenario 3): a bounded
  timeout, then a `502` response.
- What happens when the agent orchestration service returns a response that doesn't
  match the documented contract shape (e.g. malformed JSON, missing fields)? — Rejected
  at the validation boundary (Zod), treated the same as an upstream failure (`502`), per
  constitution Principle I: raw, unvalidated data crossing the service boundary must
  never be forwarded into application logic or persisted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept a free-form JD text over HTTP (`POST
  /jd-submissions`, same public contract as the original specs/001 feature).
- **FR-002**: The system MUST forward the JD text to the agent orchestration service
  over the documented internal HTTP contract (contracts/agent-orchestration.yaml) and
  MUST validate the response against a schema before using it for anything downstream
  (constitution Principle I).
- **FR-003**: When the agent orchestration service reports the submission as
  sufficient, the system MUST persist the JD submission (status `accepted`, extracted
  role/tech-stack/seniority/seniorityInferred) and all returned candidate training
  directions (linked to that submission), using the Prisma schema already defined in
  specs/002-nestjs-prisma-migration/data-model.md.
- **FR-004**: When the agent orchestration service reports the submission as
  insufficient, the system MUST persist the JD submission as rejected (status
  `rejected`, with the given reason) and MUST NOT persist any candidate training
  directions.
- **FR-005**: When the agent orchestration service is unreachable, times out, or
  returns a response that fails schema validation, the system MUST return an upstream-
  failure response (`502`) and MUST NOT persist a submission record.
- **FR-006**: The system MUST validate the incoming request body (non-empty `text`
  field) before calling the agent orchestration service, and MUST reject invalid
  requests with `400` without making that call.
- **FR-007**: The system MUST NOT generate concrete training questions/task content
  within the scope of this feature — the output stops at the candidate-direction
  recommendation list.
- **FR-008**: The public response contract (`201`/`422`/`400` shapes) MUST match
  specs/001-jd-training-directions/contracts/openapi.yaml exactly, so this is a
  transparent architecture change from the API consumer's point of view, not a breaking
  one.

### Key Entities

Reuses the two entities already defined and migrated in
specs/002-nestjs-prisma-migration/data-model.md (`JdSubmission`,
`CandidateTrainingDirection`) — no schema changes in this feature. See that document for
field-level detail.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Once the agent orchestration service is deployed, a JD with clear role/
  tech-stack/seniority information produces a structured summary and 3-6 candidate
  directions in a single submission (same as specs/001's SC-001).
- **SC-002**: 100% of requests with an invalid body (missing/empty `text`) are rejected
  with `400` before any call to the agent orchestration service is attempted.
- **SC-003**: 100% of agent-orchestration-service failures (unreachable, timeout,
  contract-validation failure) result in a `502` response and zero persisted submission
  records — no partial/corrupt data is ever written.
- **SC-004**: The public HTTP contract for `POST /jd-submissions` requires zero changes
  for any client already integrated against specs/001's original contract.

## Assumptions

- The Python agent-orchestration service does not exist yet as of this feature's
  implementation. This feature defines and implements against a documented contract
  (contracts/agent-orchestration.yaml) that the Python service is expected to satisfy
  once built. End-to-end verification of Acceptance Scenarios 1-2 (the actual extraction/
  generation happy paths) is deferred until that service exists; Acceptance Scenarios 3-4
  (upstream failure, invalid request) and all persistence logic are fully verifiable now.
- The internal contract mirrors the LangGraph state-graph design already recorded in
  specs/001-jd-training-directions/research.md §4 (a single extraction+generation call
  that reports either a full result or an insufficiency reason) — this is a reasonable,
  already-agreed-upon design being relocated across a service boundary, not a new design
  decision being made here.
- A bounded timeout (rather than waiting indefinitely) applies to the call to the agent
  orchestration service; the exact duration is an implementation detail (see plan.md),
  not a business requirement.
- All other assumptions from specs/001-jd-training-directions (seniority tiers,
  technical-only direction scope, bilingual JD support, reject-rather-than-guess on
  insufficient input, truthfully-return-fewer-than-3 on sparse input) carry over
  unchanged — this feature does not revisit them, only where the logic implementing them
  physically runs.
