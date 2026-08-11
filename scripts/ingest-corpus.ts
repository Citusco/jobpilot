import 'dotenv/config';

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { z } from 'zod';

import { PrismaClient, ConceptKind, ConceptStatus } from '../src/generated/prisma/client.js';

// Idempotent, content-hash-keyed ingest of chunk_azure.py's two JSONL outputs
// into Postgres via the Prisma client NestJS itself generates — see
// specs/005-corpus-ingest-foundation/research.md §1 (why this script, not a
// Python-to-Postgres connection) and §3 (the JSONL line schemas below), and
// specs/006-corpus-structure-rebuild/data-model.md for the reshaped DocChunk.

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CHUNKS_PATH = join(ROOT, 'corpus/_meta/chunks/azure.jsonl');
const CANDIDATES_PATH = join(ROOT, 'corpus/_meta/candidates/azure.jsonl');

export const ChunkLineSchema = z.object({
  chunkId: z.string().min(1),
  patternId: z.string().min(1),
  headingPath: z.array(z.string().min(1)).min(1),
  parentChunkId: z.string().min(1).nullable(),
  sourceOffset: z.number().int().nonnegative(),
  sourceLength: z.number().int().positive(),
  content: z.string().min(1),
  sourceUrl: z.string().min(1),
  citable: z.boolean(),
  docDate: z.string().nullable(),
  contentHash: z.string().min(1),
  sourceFile: z.string().min(1),
});
export type ChunkLine = z.infer<typeof ChunkLineSchema>;

export const CandidateLineSchema = z.object({
  conceptId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['language', 'framework', 'platform', 'architecture', 'practice', 'tool', 'domain']),
  aliases: z.array(z.string()),
  related: z.array(z.string()),
  addedFrom: z.string().min(1),
  sourceFile: z.string().min(1),
});
export type CandidateLine = z.infer<typeof CandidateLineSchema>;

function readJsonl<T>(path: string, schema: z.ZodType<T>): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => schema.parse(JSON.parse(line)));
}

export async function ingestCandidates(prisma: PrismaClient, candidates: CandidateLine[]) {
  let created = 0;
  let skipped = 0;
  for (const c of candidates) {
    const existing = await prisma.concept.findUnique({ where: { conceptId: c.conceptId } });
    if (existing) {
      // FR-026: never re-propose/duplicate a pattern that already has a
      // decision recorded (candidate, active, deprecated, or rejected) —
      // a pre-existing row of ANY status means "already decided or already
      // proposed," so this run leaves it untouched.
      skipped++;
      continue;
    }
    await prisma.concept.create({
      data: {
        conceptId: c.conceptId,
        name: c.name,
        kind: c.kind as ConceptKind,
        related: c.related,
        hasCorpus: false, // set true below, once this pattern's DocChunk rows exist
        status: ConceptStatus.candidate,
        addedFrom: c.addedFrom,
      },
    });
    created++;
  }
  console.log(`[ingest-corpus] concepts: ${created} created, ${skipped} skipped (already decided)`);
}

export async function ingestChunks(prisma: PrismaClient, chunks: ChunkLine[]) {
  const bySourceFile = new Map<string, ChunkLine[]>();
  for (const c of chunks) {
    const group = bySourceFile.get(c.sourceFile) ?? [];
    group.push(c);
    bySourceFile.set(c.sourceFile, group);
  }

  let filesSkipped = 0;
  let filesReplaced = 0;
  let rowsWritten = 0;

  for (const [sourceFile, rows] of bySourceFile) {
    const patternId = rows[0].patternId;
    const incomingHash = rows[0].contentHash;

    const existingHashes = await prisma.docChunk.findMany({
      where: { patternId },
      select: { contentHash: true },
      distinct: ['contentHash'],
    });

    if (existingHashes.length === 1 && existingHashes[0].contentHash === incomingHash) {
      filesSkipped++;
      continue; // true no-op: this file's content hasn't changed (research.md §5)
    }

    // Parents (parentChunkId null) must be inserted before children: a
    // multi-row createMany becomes one INSERT statement, but Postgres checks
    // a NOT DEFERRABLE foreign key immediately after each row is inserted,
    // not batched to the end of the statement — a child row referencing a
    // parent not yet present in the table fails even within the same
    // statement, regardless of array order within a single createMany call.
    const parents = rows.filter((r) => r.parentChunkId === null);
    const children = rows.filter((r) => r.parentChunkId !== null);
    const toRow = (r: ChunkLine) => ({
      chunkId: r.chunkId,
      patternId: r.patternId,
      headingPath: r.headingPath,
      parentChunkId: r.parentChunkId,
      sourceOffset: r.sourceOffset,
      sourceLength: r.sourceLength,
      content: r.content,
      sourceUrl: r.sourceUrl,
      citable: r.citable,
      docDate: r.docDate ? new Date(r.docDate) : null,
      contentHash: r.contentHash,
    });

    await prisma.$transaction(async (tx) => {
      await tx.docChunk.deleteMany({ where: { patternId } });
      await tx.docChunk.createMany({ data: parents.map(toRow) });
      if (children.length > 0) {
        await tx.docChunk.createMany({ data: children.map(toRow) });
      }
      await tx.concept.updateMany({ where: { conceptId: patternId }, data: { hasCorpus: true } });
    });

    filesReplaced++;
    rowsWritten += rows.length;
    void sourceFile; // used only for grouping above
  }

  console.log(
    `[ingest-corpus] doc_chunks: ${filesReplaced} file(s) replaced (${rowsWritten} rows), ` +
      `${filesSkipped} file(s) unchanged (skipped)`,
  );
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const candidates = readJsonl(CANDIDATES_PATH, CandidateLineSchema);
    const chunks = readJsonl(CHUNKS_PATH, ChunkLineSchema);
    console.log(`[ingest-corpus] read ${candidates.length} candidates, ${chunks.length} chunks`);

    // Concepts before chunks: DocChunk.patternId is a foreign key to
    // Concept.conceptId (data-model.md), so the referenced row must exist first.
    await ingestCandidates(prisma, candidates);
    await ingestChunks(prisma, chunks);
  } finally {
    await prisma.$disconnect();
  }
}

// Guarded so importing this module (e.g. from a test) never triggers a real
// run — main() only executes when this file is the process entry point.
// pathToFileURL (not manual string concatenation) is required here: a naive
// `file://${path}` is missing the third slash Windows drive-letter paths
// need (file:///D:/... not file://D:/...), which silently made this guard
// always false on Windows and meant `node scripts/ingest-corpus.ts` never
// actually ran main() at all — caught by actually running it end-to-end
// against a real database, not by inspection.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  void main();
}
