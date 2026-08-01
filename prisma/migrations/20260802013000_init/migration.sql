-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "jd_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "raw_text" TEXT NOT NULL,
    "role" TEXT,
    "tech_stack" TEXT[],
    "seniority" TEXT,
    "seniority_inferred" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "jd_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_training_directions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jd_submission_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL,
    "suggested_question_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "candidate_training_directions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "candidate_training_directions" ADD CONSTRAINT "candidate_training_directions_jd_submission_id_fkey" FOREIGN KEY ("jd_submission_id") REFERENCES "jd_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateCheckConstraint (hand-added — Prisma's schema DSL has no CHECK syntax; see data-model.md)
ALTER TABLE "jd_submissions" ADD CONSTRAINT "jd_submissions_status_check" CHECK ("status" IN ('accepted', 'rejected'));

-- CreateCheckConstraint (hand-added — Prisma's schema DSL has no CHECK syntax; see data-model.md)
ALTER TABLE "candidate_training_directions" ADD CONSTRAINT "candidate_training_directions_question_count_check" CHECK ("suggested_question_count" > 0);
