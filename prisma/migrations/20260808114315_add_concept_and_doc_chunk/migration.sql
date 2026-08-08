-- CreateEnum
CREATE TYPE "ConceptKind" AS ENUM ('language', 'framework', 'platform', 'architecture', 'practice', 'tool', 'domain');

-- CreateEnum
CREATE TYPE "ConceptStatus" AS ENUM ('candidate', 'active', 'deprecated', 'rejected');

-- CreateEnum
CREATE TYPE "ChunkKind" AS ENUM ('cost', 'benefit', 'when', 'example', 'meta', 'unmapped');

-- CreateEnum
CREATE TYPE "KindConfidence" AS ENUM ('regex', 'llm', 'manual');

-- CreateTable
CREATE TABLE "concepts" (
    "concept_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "kind" "ConceptKind" NOT NULL,
    "related" TEXT[],
    "has_corpus" BOOLEAN NOT NULL DEFAULT false,
    "embedding" vector(1536),
    "status" "ConceptStatus" NOT NULL DEFAULT 'candidate',
    "added_from" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "concepts_pkey" PRIMARY KEY ("concept_id")
);

-- CreateTable
CREATE TABLE "doc_chunks" (
    "chunk_id" TEXT NOT NULL,
    "pattern_id" TEXT NOT NULL,
    "kind" "ChunkKind" NOT NULL,
    "label" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "context_prefix" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "citable" BOOLEAN NOT NULL,
    "kind_confidence" "KindConfidence" NOT NULL,
    "doc_date" TIMESTAMPTZ,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "doc_chunks_pkey" PRIMARY KEY ("chunk_id")
);

-- CreateIndex
CREATE INDEX "doc_chunks_pattern_id_idx" ON "doc_chunks"("pattern_id");

-- CreateIndex
CREATE INDEX "doc_chunks_content_hash_idx" ON "doc_chunks"("content_hash");

-- AddForeignKey
ALTER TABLE "doc_chunks" ADD CONSTRAINT "doc_chunks_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "concepts"("concept_id") ON DELETE RESTRICT ON UPDATE CASCADE;
