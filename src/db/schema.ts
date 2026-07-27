import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const jdSubmissions = pgTable(
  'jd_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rawText: text('raw_text').notNull(),
    role: text('role'),
    techStack: text('tech_stack').array(),
    seniority: text('seniority'),
    seniorityInferred: boolean('seniority_inferred').notNull().default(false),
    status: text('status').notNull(),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('jd_submissions_status_check', sql`${table.status} IN ('accepted', 'rejected')`)],
);

export const candidateTrainingDirections = pgTable(
  'candidate_training_directions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jdSubmissionId: uuid('jd_submission_id')
      .notNull()
      .references(() => jdSubmissions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rationale: text('rationale').notNull(),
    tags: text('tags').array().notNull(),
    suggestedQuestionCount: integer('suggested_question_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('candidate_training_directions_question_count_check', sql`${table.suggestedQuestionCount} > 0`),
  ],
);
