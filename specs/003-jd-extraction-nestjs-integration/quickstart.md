# Quickstart: JD Extraction NestJS Integration

Validates spec.md's acceptance scenarios. The agent orchestration service does not exist
yet (see spec.md Background), so §1 below cannot be run against a real deployment —
everything else can.

## 1. Happy path / rejection path (NOT runnable yet — documented for when the agent service exists)

```sh
curl -i -X POST http://localhost:3000/jd-submissions \
  -H "Content-Type: application/json" \
  -d '{"text": "<a real JD text>"}'
```

**Expected once the agent service is deployed**: `201` with `extraction` + `directions`
(Acceptance Scenario 1), or `422` with a `reason` if the agent service judges the text
insufficient (Acceptance Scenario 2).

## 2. Invalid request (runnable now)

```sh
curl -i -X POST http://localhost:3000/jd-submissions \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected**: `400`, and no outbound call is made to the agent orchestration service
(confirm via logs — no "calling agent service" log line).

## 3. Upstream failure (runnable now — this is the realistic path until the agent service exists)

```sh
# With AGENT_SERVICE_URL pointing at a port nothing is listening on:
curl -i -X POST http://localhost:3000/jd-submissions \
  -H "Content-Type: application/json" \
  -d '{"text": "Senior Backend Engineer, Node.js, PostgreSQL, AWS"}'
```

**Expected**: `502` with a message indicating the upstream agent orchestration service
was unreachable. Confirm via `psql` that no row was written to `jd_submissions` for this
attempt (FR-005, SC-003).

## 4. Automated tests

```sh
npm run typecheck && npm run lint && npm test
```

**Expected**: all pass. Per research.md §4, the agent-service HTTP call is mocked in
these tests — they do not require a running agent orchestration service.
