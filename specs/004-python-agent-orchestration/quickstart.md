# Quickstart: Python Agent Orchestration Service

Validates spec.md's acceptance scenarios and success criteria. Requires a real
`OPENAI_API_KEY` for §1-§2 (this feature explicitly does not mock the LLM for manual
end-to-end verification — automated tests do that; quickstart proves the real thing
works).

## 1. Sufficient JD text (Acceptance Scenario 1, SC-001, SC-003)

```sh
cd agent-service
uv run uvicorn agent_service.main:app --reload &
curl -i -X POST http://localhost:8000/extract \
  -H "Content-Type: application/json" \
  -d '{"text": "Senior Backend Engineer, 5+ years, Node.js, PostgreSQL, AWS, distributed systems experience required."}'
```

**Expected**: `200` within 25 seconds, `{"sufficient": true, "extraction": {...}, "directions": [...]}` with 0-6 directions, each with `name`/`rationale`/`tags`/`suggestedQuestionCount`. Per spec.md's Assumptions, judge only the *shape* and *presence* of a real result — not whether the extraction/directions are good.

## 2. Insufficient JD text (Acceptance Scenario 2, SC-002)

```sh
curl -i -X POST http://localhost:8000/extract \
  -H "Content-Type: application/json" \
  -d '{"text": "hi"}'
```

**Expected**: `200` (insufficient is a normal outcome, not an error — per
`contracts/agent-orchestration.yaml`), `{"sufficient": false, "reason": "..."}`.

## 3. Invalid request (Acceptance Scenario 3)

```sh
curl -i -X POST http://localhost:8000/extract -H "Content-Type: application/json" -d '{}'
```

**Expected**: `4xx`, no LLM call made (confirm via logs / LangSmith — no trace recorded
for this request).

## 4. LangSmith tracing

After running §1, check the LangSmith project dashboard (`LANGCHAIN_PROJECT` from
`.env`) for a trace covering both the `extract_jd_structure` and
`generate_candidate_directions` node calls. This is the concrete "experience LangChain's
observability" checkpoint from the constitution v2.1.0 discussion — not a pass/fail
correctness check.

## 5. Full pipeline, end-to-end (SC-004 — the actual point of this feature)

Requires both services running plus the Postgres container from SCRUM-38/39
(`jobpilot-postgres`), and the NestJS service's `AGENT_SERVICE_URL` pointing at this
service (`http://localhost:8000`).

```sh
# Terminal 1: this service
cd agent-service && uv run uvicorn agent_service.main:app --reload

# Terminal 2: NestJS service
cd .. && npm run dev

# Terminal 3
curl -i -X POST http://localhost:3000/jd-submissions \
  -H "Content-Type: application/json" \
  -d '{"text": "Senior Backend Engineer, 5+ years, Node.js, PostgreSQL, AWS."}'
```

**Expected**: `201` (not `502`) — this is the first time in the project this full chain
(NestJS → Python → OpenAI → back → Postgres) has ever actually completed. Confirm via
`psql` that a `jd_submissions` row (and `candidate_training_directions` rows) were
written, matching what the HTTP response reported.

## 6. Automated tests

```sh
cd agent-service && uv run pytest && uv run mypy src && uv run ruff check .
```

**Expected**: all pass. LLM calls are mocked in these tests (Principle II) — they do
not require `OPENAI_API_KEY` or a running LangSmith project.
