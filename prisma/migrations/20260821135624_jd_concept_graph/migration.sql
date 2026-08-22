/*
  Warnings:

  - You are about to drop the column `rejection_reason` on the `jd_submissions` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `jd_submissions` table. All the data in the column will be lost.
  - You are about to drop the column `seniority` on the `jd_submissions` table. All the data in the column will be lost.
  - You are about to drop the column `seniority_inferred` on the `jd_submissions` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `jd_submissions` table. All the data in the column will be lost.
  - You are about to drop the column `tech_stack` on the `jd_submissions` table. All the data in the column will be lost.
  - You are about to drop the `candidate_training_directions` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ResolutionTier" AS ENUM ('exact', 'similarity', 'unresolved');

-- DropForeignKey
ALTER TABLE "candidate_training_directions" DROP CONSTRAINT "candidate_training_directions_jd_submission_id_fkey";

-- AlterTable
ALTER TABLE "jd_submissions" DROP COLUMN "rejection_reason",
DROP COLUMN "role",
DROP COLUMN "seniority",
DROP COLUMN "seniority_inferred",
DROP COLUMN "status",
DROP COLUMN "tech_stack";

-- DropTable
DROP TABLE "candidate_training_directions";

-- CreateTable
CREATE TABLE "extracted_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "surface" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "evidence" TEXT[],
    "concept_id" TEXT,
    "tier" "ResolutionTier" NOT NULL,
    "score" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extracted_items_submission_id_idx" ON "extracted_items"("submission_id");

-- CreateIndex
CREATE INDEX "extracted_items_concept_id_idx" ON "extracted_items"("concept_id");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_items_submission_id_normalized_key" ON "extracted_items"("submission_id", "normalized");

-- AddForeignKey
ALTER TABLE "extracted_items" ADD CONSTRAINT "extracted_items_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "jd_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_items" ADD CONSTRAINT "extracted_items_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("concept_id") ON DELETE RESTRICT ON UPDATE CASCADE;
