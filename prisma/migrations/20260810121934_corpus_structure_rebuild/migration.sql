-- Corpus structure rebuild (SCRUM-44, specs/006-corpus-structure-rebuild)
--
-- Truncates doc_chunks before the shape change: `kind` and `kind_confidence`
-- are dropped (both NOT NULL, no default) and `source_offset`/`source_length`
-- are added NOT NULL with no default, which is impossible to backfill for
-- existing rows without inventing data. This is safe: every row is
-- reproducible from the source layer (corpus/raw/, re-fetched and verified
-- against corpus/_meta/manifest/), and every chunk_id changes in this
-- feature anyway since the `kind` segment it was built from no longer
-- exists. `concepts` rows are preserved -- concept_id is never renamed.
TRUNCATE TABLE "doc_chunks";

-- CreateEnum
CREATE TYPE "TermType" AS ENUM ('id', 'name', 'title', 'alias');

-- AlterTable
ALTER TABLE "concepts" DROP COLUMN "aliases";

-- AlterTable
ALTER TABLE "doc_chunks" DROP COLUMN "context_prefix",
DROP COLUMN "kind",
DROP COLUMN "kind_confidence",
DROP COLUMN "label",
ADD COLUMN     "embedding" vector(1536),
ADD COLUMN     "heading_path" TEXT[],
ADD COLUMN     "parent_chunk_id" TEXT,
ADD COLUMN     "source_length" INTEGER NOT NULL,
ADD COLUMN     "source_offset" INTEGER NOT NULL;

-- DropEnum
DROP TYPE "ChunkKind";

-- DropEnum
DROP TYPE "KindConfidence";

-- CreateTable
CREATE TABLE "concept_terms" (
    "term" TEXT NOT NULL,
    "display_term" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "term_type" "TermType" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_terms_pkey" PRIMARY KEY ("term")
);

-- CreateIndex
CREATE INDEX "concept_terms_concept_id_idx" ON "concept_terms"("concept_id");

-- CreateIndex
CREATE INDEX "doc_chunks_parent_chunk_id_idx" ON "doc_chunks"("parent_chunk_id");

-- AddForeignKey
ALTER TABLE "concept_terms" ADD CONSTRAINT "concept_terms_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "concepts"("concept_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_chunks" ADD CONSTRAINT "doc_chunks_parent_chunk_id_fkey" FOREIGN KEY ("parent_chunk_id") REFERENCES "doc_chunks"("chunk_id") ON DELETE CASCADE ON UPDATE CASCADE;
