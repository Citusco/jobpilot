# Phase 1 Data Model: JD Structured Extraction and Candidate Training Direction Recommendation

## Entity Overview

Corresponds to the spec's Key Entities: JD Submission and Candidate Training Direction,
in a one-to-many relationship (one submission → 3-6 directions, or fewer when
information is sparse).

## JD Submission (`jd_submissions` table)

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | for future reference by FR-013 |
| `raw_text` | `text` | NOT NULL | the raw JD text; rationale traceability (FR-006) depends on this field |
| `role` | `text` | NULL | the extracted role; NULL for a rejected submission |
| `tech_stack` | `text[]` | NULL | the extracted tech-stack list |
| `seniority` | `text` | NULL | the extracted or inferred seniority level (Junior/Mid-level/Senior/Staff) |
| `seniority_inferred` | `boolean` | NOT NULL, default `false` | corresponds to FR-010, marks whether the seniority level was inferred rather than explicitly stated |
| `status` | `text` | NOT NULL, CHECK IN (`'accepted'`, `'rejected'`) | corresponds to the rejection branch of FR-011 |
| `rejection_reason` | `text` | NULL | populated only when `status = 'rejected'` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Validation rules** (application layer, already passed Zod validation before being
written to the database):
- When `status = 'rejected'`, `role` / `tech_stack` / `seniority` are all NULL, and
  `rejection_reason` is required (FR-011).
- When `status = 'accepted'`, `role` and `tech_stack` (at least 1 item) are required;
  `seniority` is required, and `seniority_inferred` must be consistent with the
  extraction node's judgment (FR-010).

**State transitions**: There is only a single write, with no subsequent state change
(editing/resubmission is not supported within the scope of this feature; FR-009 makes
clear the question-generation step is out of scope for this feature).

## Candidate Training Direction (`candidate_training_directions` table)

| Field | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `jd_submission_id` | `uuid` | NOT NULL, FK → `jd_submissions.id` ON DELETE CASCADE | links to the submission it belongs to (FR-013) |
| `name` | `text` | NOT NULL | direction name |
| `rationale` | `text` | NOT NULL | recommendation rationale; MUST include a verifiable quote from the JD original text (FR-006) |
| `tags` | `text[]` | NOT NULL, at least 1 item | descriptive tags (FR-007) |
| `suggested_question_count` | `integer` | NOT NULL, CHECK > 0 | suggested question count (FR-008) |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Validation rules**:
- The number of rows under a given `jd_submission_id` ∈ [0, 6]; when the owning
  submission's `status = 'accepted'` it should be ≥ 1 (see the boundary-handling
  decision in research.md §5); when `status = 'rejected'` it should be 0 (enforced by
  application logic rather than an extra database CHECK trigger, to avoid
  over-engineering).
- The `rationale` field only gets a non-empty check; "whether it's genuinely traceable
  to the original text" is guaranteed by the manual spot-checking in SC-002, and is not
  semantically validated at the database layer.

## Database-Layer Implementation

The two tables above are defined in `src/db/schema.ts` using `pgTable(...)` from
`drizzle-orm/pg-core` (rather than hand-written SQL DDL); when the table structure
changes, `drizzle-kit generate` automatically generates the corresponding migration file
into `src/db/migrations/`, and `drizzle-kit migrate` is responsible for running it. The
query layer uses the TS types Drizzle derives from the schema directly, without
separately maintaining a hand-written set of row type definitions (see research.md §2
for the rationale behind this choice).

## Corresponding Zod Schemas (LLM I/O boundary, Constitution I)

### `jdExtraction.schema.ts`

```ts
extractionResultSchema = z.object({
  sufficient: z.boolean(),
  insufficientReason: z.string().optional(), // required when sufficient=false, validated with refine
  role: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  seniority: z.string().optional(),
  seniorityInferred: z.boolean().optional(),
})
```

### `candidateDirections.schema.ts`

```ts
candidateDirectionSchema = z.object({
  name: z.string(),
  rationale: z.string(),
  tags: z.array(z.string()).min(1),
  suggestedQuestionCount: z.number().int().positive(),
})

candidateDirectionsResultSchema = z.object({
  directions: z.array(candidateDirectionSchema).max(6),
})
```

Both schemas are injected into the OpenAI Structured Outputs request via
`zodResponseFormat` (see research.md §1); once the response comes back, the same schema
is used to run `.parse()` a second time for validation.

## Relationship to the Fastify Response DTO

The route layer's response body is assembled directly by reusing the TypeScript types
derived from the Zod schemas above (`z.infer<typeof ...>`), plus the database-generated
`id` / `createdAt`, avoiding the need to maintain a third, duplicate set of type
definitions.
