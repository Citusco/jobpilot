import 'dotenv/config';

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { z } from 'zod';

import {
  PrismaClient,
  ConceptKind,
  ConceptStatus,
  ChunkKind,
  KindConfidence,
} from '../src/generated/prisma/client.js';

// Idempotent, content-hash-keyed ingest of chunk_azure.py's two JSONL outputs
// into Postgres via the Prisma client NestJS itself generates — see
// specs/005-corpus-ingest-foundation/research.md §1 (why this script, not a
// Python-to-Postgres connection) and §3 (the JSONL line schemas below).

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CHUNKS_PATH = join(ROOT, 'corpus/_meta/chunks/azure.jsonl');
const CANDIDATES_PATH = join(ROOT, 'corpus/_meta/candidates/azure.jsonl');
const REPORT_PATH = join(ROOT, 'corpus/reports/unmapped-headings-azure.md');

export const ChunkLineSchema = z.object({
  chunkId: z.string().min(1),
  patternId: z.string().min(1),
  kind: z.enum(['cost', 'benefit', 'when', 'example', 'meta', 'unmapped']),
  label: z.string().min(1),
  content: z.string().min(1),
  contextPrefix: z.string().min(1),
  sourceUrl: z.string().min(1),
  citable: z.boolean(),
  kindConfidence: z.enum(['regex', 'llm', 'manual']),
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
        aliases: c.aliases,
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

    await prisma.$transaction(async (tx) => {
      await tx.docChunk.deleteMany({ where: { patternId } });
      await tx.docChunk.createMany({
        data: rows.map((r) => ({
          chunkId: r.chunkId,
          patternId: r.patternId,
          kind: r.kind as ChunkKind,
          label: r.label,
          content: r.content,
          contextPrefix: r.contextPrefix,
          sourceUrl: r.sourceUrl,
          citable: r.citable,
          kindConfidence: r.kindConfidence as KindConfidence,
          docDate: r.docDate ? new Date(r.docDate) : null,
          contentHash: r.contentHash,
        })),
      });
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

function writeUnmappedReportPassthrough() {
  // The unmapped-headings report is written by chunk_azure.py (pure text
  // processing, no DB dependency — see plan.md's Project Structure). This
  // ingest script only confirms it exists; it does not regenerate it.
  if (!existsSync(REPORT_PATH)) {
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(
      REPORT_PATH,
      '# Unmapped headings — azure corpus\n\n(not yet generated — run corpus/tools/chunk_azure.py first)\n',
      'utf-8',
    );
    console.warn(`[ingest-corpus] WARNING: ${REPORT_PATH} did not exist; wrote a placeholder`);
  }
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
    writeUnmappedReportPassthrough();
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
