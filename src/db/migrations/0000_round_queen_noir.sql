CREATE TABLE "candidate_training_directions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jd_submission_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rationale" text NOT NULL,
	"tags" text[] NOT NULL,
	"suggested_question_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_training_directions_question_count_check" CHECK ("candidate_training_directions"."suggested_question_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "jd_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_text" text NOT NULL,
	"role" text,
	"tech_stack" text[],
	"seniority" text,
	"seniority_inferred" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jd_submissions_status_check" CHECK ("jd_submissions"."status" IN ('accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "candidate_training_directions" ADD CONSTRAINT "candidate_training_directions_jd_submission_id_jd_submissions_id_fk" FOREIGN KEY ("jd_submission_id") REFERENCES "public"."jd_submissions"("id") ON DELETE cascade ON UPDATE no action;