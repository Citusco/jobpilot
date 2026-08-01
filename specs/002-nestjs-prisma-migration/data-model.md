# Phase 1 Data Model: NestJS + Prisma API Migration

## Entity Overview

Re-expresses the same two entities already established under SCRUM-3
(`src/db/schema.ts`, Drizzle) in Prisma, with no change to field names, types, or
constraints — a one-to-many relationship between JD Submission and Candidate Training
Direction, unchanged from the original design.

## JD Submission (`jd_submissions` table, Prisma model `JdSubmission`)

| Field | Prisma type | Constraints | Description |
|---|---|---|---|
| `id` | `String @id @default(uuid()) @db.Uuid` | PK | matches Drizzle's `uuid().primaryKey().defaultRandom()` |
| `rawText` | `String` | NOT NULL | maps to column `raw_text` |
| `role` | `String?` | NULL | |
| `techStack` | `String[]` | NULL (empty array allowed) | maps to column `tech_stack`, `text[]` |
| `seniority` | `String?` | NULL | |
| `seniorityInferred` | `Boolean @default(false)` | NOT NULL | maps to column `seniority_inferred` |
| `status` | `String` | NOT NULL, CHECK IN (`'accepted'`, `'rejected'`) | maps to column `status`; Prisma has no native CHECK syntax, so the constraint is added via a raw-SQL block in the generated migration (see below) |
| `rejectionReason` | `String?` | NULL | maps to column `rejection_reason` |
| `createdAt` | `DateTime @default(now()) @db.Timestamptz` | NOT NULL | maps to column `created_at` |

Table name pinned with `@@map("jd_submissions")` so the physical table name is unchanged
from the Drizzle-era schema (required by spec FR-004: the new migration must create the
same tables).

## Candidate Training Direction (`candidate_training_directions` table, Prisma model `CandidateTrainingDirection`)

| Field | Prisma type | Constraints | Description |
|---|---|---|---|
| `id` | `String @id @default(uuid()) @db.Uuid` | PK | |
| `jdSubmissionId` | `String @db.Uuid` | NOT NULL, FK → `JdSubmission.id`, `onDelete: Cascade` | maps to column `jd_submission_id` |
| `name` | `String` | NOT NULL | |
| `rationale` | `String` | NOT NULL | |
| `tags` | `String[]` | NOT NULL | |
| `suggestedQuestionCount` | `Int` | NOT NULL, CHECK > 0 | maps to column `suggested_question_count`; CHECK added via raw-SQL block in the migration, same as above |
| `createdAt` | `DateTime @default(now()) @db.Timestamptz` | NOT NULL | |

Table name pinned with `@@map("candidate_training_directions")`.

**Relation**: `JdSubmission` has many `CandidateTrainingDirection`, `onDelete: Cascade` —
same as the existing foreign key
(`candidate_training_directions_jd_submission_id_jd_submissions_id_fk`).

## CHECK constraints and array NOT NULL via hand-edited migration SQL

Prisma's schema DSL has no first-class `CHECK` constraint syntax. `prisma migrate dev`
generates a SQL migration file from the schema; the two existing CHECK constraints
(`jd_submissions_status_check`, `candidate_training_directions_question_count_check`) are
added to that generated migration file by hand, with the same names and conditions as the
current Drizzle migration, before it's applied. This is a one-time manual edit per
migration generation, not an ongoing maintenance burden — Prisma migrations that don't
change these two columns won't need to touch this block again.

**Second, related caveat found while implementing**: Prisma never emits `NOT NULL` on a
Postgres array (`String[]`) column, even when the corresponding Prisma field is required
(no `?`) — confirmed via `prisma migrate diff --from-empty --to-schema-datamodel` against
this schema, which produced `"tags" TEXT[]` with no `NOT NULL`, unlike the original
Drizzle column (`text('tags').array().notNull()`). `CandidateTrainingDirection.tags` is
required data per FR-007/data-model.md, so its migration's `NOT NULL` is also hand-added,
the same way the CHECK constraints are — Prisma's own tooling won't regenerate it if the
migration is ever recreated from scratch. `JdSubmission.techStack` needs no such fix: it
was nullable in the original schema too, so Prisma's default (no `NOT NULL`) already
matches.

## State transitions

None — both entities are write-once for the scope of this feature (this feature does not
implement the write path itself; see spec.md Assumptions — it only needs the schema and a
`PrismaService` future feature code can write through).

## Prisma Client access layer (FR-008)

A single injectable `PrismaService` (`src/prisma/prisma.service.ts`) extends
`PrismaClient` and manages its connection lifecycle via NestJS's `OnModuleInit`/
`OnModuleDestroy` hooks. This is the full extent of the "data-access layer" this feature
provides — no bespoke repository classes are introduced, since no business logic exists
yet to justify one (see spec.md Assumptions: business endpoints are future feature work).
Future features inject `PrismaService` directly and call `this.prisma.jdSubmission...` /
`this.prisma.candidateTrainingDirection...`.
