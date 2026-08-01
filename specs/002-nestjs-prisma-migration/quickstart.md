# Quickstart: NestJS + Prisma API Migration

Validates the acceptance scenarios in spec.md end-to-end. Assumes a local Postgres
instance is available and `DATABASE_URL` is set (same precondition as the prior
Drizzle-based setup).

## 1. Apply the migration to a fresh database (User Story 2, FR-003/004/005)

```sh
npx prisma migrate dev
```

**Expected**: creates `jd_submissions` and `candidate_training_directions` tables with
the same columns/types/constraints as the old Drizzle migration (see data-model.md), plus
runs `CREATE EXTENSION IF NOT EXISTS vector;`. Confirm with:

```sh
psql "$DATABASE_URL" -c "\d jd_submissions" -c "\d candidate_training_directions" -c "\dx vector"
```

## 2. Start the service and confirm the health check (User Story 1, FR-001/002)

```sh
npm run dev
curl -i http://localhost:3000/health
```

**Expected**: service starts without errors; `curl` returns `200` with body
`{"status":"ok"}` within 10 seconds of starting the dev command (SC-001).

## 3. Confirm the quality gate and clean cutover (User Story 3, FR-006/007)

```sh
npm run typecheck
npm run lint
npm run test
grep -ril "fastify\|drizzle" package.json src/ --include="*.ts" --include="*.json"
```

**Expected**: the three quality-gate commands all pass; the `grep` finds nothing (empty
output, matching SC-003).
