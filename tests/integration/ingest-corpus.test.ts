import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '../../src/generated/prisma/client.js';
import { ingestCandidates, ingestChunks, type ChunkLine, type CandidateLine } from '../../scripts/ingest-corpus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// Requires a real (test) Postgres database reachable via DATABASE_URL, with
// the migration in specs/006-corpus-structure-rebuild applied — see
// quickstart.md. Each test uses its own randomly-generated conceptId so
// tests never collide with each other or with real corpus data, and cleans
// up after itself.
describe('scripts/ingest-corpus.ts (integration)', () => {
  const prisma = new PrismaClient();
  let testConceptId: string;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(() => {
    testConceptId = `test-concept-${randomUUID()}`;
  });

  afterEach(async () => {
    await prisma.docChunk.deleteMany({ where: { patternId: testConceptId } });
    await prisma.concept.deleteMany({ where: { conceptId: testConceptId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('DocChunk write path (User Story 1)', () => {
    it('inserts a DocChunk row for a seeded Concept fixture, independent of candidate generation (US3)', async () => {
      await prisma.concept.create({
        data: {
          conceptId: testConceptId,
          name: 'Test Concept',
          kind: 'architecture',
          related: [],
          status: 'candidate',
          addedFrom: 'test-fixture',
        },
      });

      const chunk: ChunkLine = {
        chunkId: `test:${testConceptId}:example`,
        patternId: testConceptId,
        headingPath: ['Test Concept', 'Example'],
        parentChunkId: null,
        sourceOffset: 0,
        sourceLength: 31,
        content: 'This is verbatim test content.',
        sourceUrl: 'https://example.com/test',
        citable: true,
        docDate: null,
        contentHash: 'hash-v1',
        sourceFile: 'test.md',
      };

      await ingestChunks(prisma, [chunk]);

      const rows = await prisma.docChunk.findMany({ where: { patternId: testConceptId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe('This is verbatim test content.');
      expect(rows[0].headingPath).toEqual(['Test Concept', 'Example']);
      expect(rows[0].parentChunkId).toBeNull();

      const concept = await prisma.concept.findUnique({ where: { conceptId: testConceptId } });
      expect(concept?.hasCorpus).toBe(true);
    });

    it('inserts the parent section before its children so the self-referencing foreign key resolves', async () => {
      await prisma.concept.create({
        data: {
          conceptId: testConceptId,
          name: 'Test Concept',
          kind: 'architecture',
          related: [],
          status: 'candidate',
          addedFrom: 'test-fixture',
        },
      });

      const parentId = `test:${testConceptId}:long-section`;
      const parent: ChunkLine = {
        chunkId: parentId,
        patternId: testConceptId,
        headingPath: ['Test Concept', 'Long Section'],
        parentChunkId: null,
        sourceOffset: 0,
        sourceLength: 40,
        content: 'Parent span covering the whole section.',
        sourceUrl: 'https://example.com/test',
        citable: true,
        docDate: null,
        contentHash: 'hash-v1',
        sourceFile: 'test.md',
      };
      const child: ChunkLine = {
        chunkId: `${parentId}:a1b2c3d4`,
        patternId: testConceptId,
        headingPath: ['Test Concept', 'Long Section'],
        parentChunkId: parentId,
        sourceOffset: 0,
        sourceLength: 20,
        content: 'Parent span covering',
        sourceUrl: 'https://example.com/test',
        citable: true,
        docDate: null,
        contentHash: 'hash-v1',
        sourceFile: 'test.md',
      };

      // Deliberately child-before-parent in the input array: the ingest
      // function, not caller ordering, is what must get this right.
      await expect(ingestChunks(prisma, [child, parent])).resolves.not.toThrow();

      const rows = await prisma.docChunk.findMany({ where: { patternId: testConceptId } });
      expect(rows).toHaveLength(2);
      const childRow = rows.find((r) => r.chunkId === child.chunkId);
      expect(childRow?.parentChunkId).toBe(parentId);
    });

    it('is idempotent: re-running with an unchanged content_hash is a true no-op (SC-002)', async () => {
      await prisma.concept.create({
        data: {
          conceptId: testConceptId,
          name: 'Test Concept',
          kind: 'architecture',
          related: [],
          status: 'candidate',
          addedFrom: 'test-fixture',
        },
      });
      const chunk: ChunkLine = {
        chunkId: `test:${testConceptId}:example`,
        patternId: testConceptId,
        headingPath: ['Test Concept', 'Example'],
        parentChunkId: null,
        sourceOffset: 0,
        sourceLength: 19,
        content: 'Unchanged content.',
        sourceUrl: 'https://example.com/test',
        citable: true,
        docDate: null,
        contentHash: 'hash-v1',
        sourceFile: 'test.md',
      };

      await ingestChunks(prisma, [chunk]);
      const before = await prisma.docChunk.findMany({ where: { patternId: testConceptId } });

      await ingestChunks(prisma, [chunk]);
      const after = await prisma.docChunk.findMany({ where: { patternId: testConceptId } });

      expect(after).toHaveLength(before.length);
      expect(after[0].updatedAt).toEqual(before[0].updatedAt); // row genuinely untouched, not just same count
    });

    it("deletes and replaces exactly that file's rows when its content_hash changes (research.md §5)", async () => {
      await prisma.concept.create({
        data: {
          conceptId: testConceptId,
          name: 'Test Concept',
          kind: 'architecture',
          related: [],
          status: 'candidate',
          addedFrom: 'test-fixture',
        },
      });
      const v1: ChunkLine = {
        chunkId: `test:${testConceptId}:example`,
        patternId: testConceptId,
        headingPath: ['Test Concept', 'Example'],
        parentChunkId: null,
        sourceOffset: 0,
        sourceLength: 12,
        content: 'Version one.',
        sourceUrl: 'https://example.com/test',
        citable: true,
        docDate: null,
        contentHash: 'hash-v1',
        sourceFile: 'test.md',
      };
      await ingestChunks(prisma, [v1]);

      const v2: ChunkLine = { ...v1, content: 'Version two.', contentHash: 'hash-v2' };
      await ingestChunks(prisma, [v2]);

      const rows = await prisma.docChunk.findMany({ where: { patternId: testConceptId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe('Version two.');
      expect(rows[0].contentHash).toBe('hash-v2');
    });
  });

  describe('Concept candidate write path (User Story 3)', () => {
    it('creates a candidate with status "candidate", never "active" (FR-024/FR-025)', async () => {
      const candidate: CandidateLine = {
        conceptId: testConceptId,
        name: 'Test Concept',
        kind: 'architecture',
        aliases: [],
        related: [],
        addedFrom: 'seed',
        sourceFile: 'test.md',
      };
      await ingestCandidates(prisma, [candidate]);
      const row = await prisma.concept.findUnique({ where: { conceptId: testConceptId } });
      expect(row?.status).toBe('candidate');
    });

    it('does not re-propose or duplicate a pattern that already has a decision recorded (FR-026)', async () => {
      await prisma.concept.create({
        data: {
          conceptId: testConceptId,
          name: 'Already Active',
          kind: 'architecture',
          related: [],
          status: 'active',
          addedFrom: 'seed',
        },
      });
      const candidate: CandidateLine = {
        conceptId: testConceptId,
        name: 'Test Concept (re-proposed)',
        kind: 'architecture',
        aliases: [],
        related: [],
        addedFrom: 'seed',
        sourceFile: 'test.md',
      };
      await ingestCandidates(prisma, [candidate]);
      const row = await prisma.concept.findUnique({ where: { conceptId: testConceptId } });
      expect(row?.status).toBe('active'); // unchanged
      expect(row?.name).toBe('Already Active'); // untouched, not overwritten by the re-run
    });
  });

  describe('Real corpus round-trip (User Story 1)', () => {
    // Distinct claim from the chunker's own coverage test
    // (corpus/tools/tests/test_chunk_azure.py): that test proves the JSONL
    // the chunker WRITES is complete. This proves the loader doesn't lose
    // anything on the way INTO Postgres -- the chunker being correct and the
    // loader being correct are different claims (tasks.md T007).
    it('preserves total leaf byte coverage after a full ingest into the database', async () => {
      const chunksPath = join(ROOT, 'corpus/_meta/chunks/azure.jsonl');
      let fileText: string;
      try {
        fileText = readFileSync(chunksPath, 'utf-8');
      } catch {
        console.warn('[test] corpus/_meta/chunks/azure.jsonl not present -- run chunk_azure.py first; skipping');
        return;
      }

      const rows: ChunkLine[] = fileText
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l));
      const testConceptIds = [...new Set(rows.map((r) => r.patternId))];

      // Concepts referenced by these chunks must exist first (FK).
      for (const conceptId of testConceptIds) {
        await prisma.concept.upsert({
          where: { conceptId },
          update: {},
          create: {
            conceptId,
            name: conceptId,
            kind: 'architecture',
            related: [],
            status: 'candidate',
            addedFrom: 'test-fixture',
          },
        });
      }

      try {
        await ingestChunks(prisma, rows);

        const dbRows = await prisma.docChunk.findMany({
          where: { patternId: { in: testConceptIds } },
          select: { chunkId: true, parentChunkId: true, sourceLength: true },
        });
        const parentIds = new Set(dbRows.map((r) => r.parentChunkId).filter((v): v is string => v !== null));
        const dbLeafBytes = dbRows
          .filter((r) => !parentIds.has(r.chunkId))
          .reduce((sum, r) => sum + r.sourceLength, 0);

        const jsonlParentIds = new Set(rows.map((r) => r.parentChunkId).filter((v): v is string => v !== null));
        const jsonlLeafBytes = rows
          .filter((r) => !jsonlParentIds.has(r.chunkId))
          .reduce((sum, r) => sum + r.sourceLength, 0);

        expect(dbRows).toHaveLength(rows.length);
        expect(dbLeafBytes).toBe(jsonlLeafBytes);
      } finally {
        await prisma.docChunk.deleteMany({ where: { patternId: { in: testConceptIds } } });
        await prisma.concept.deleteMany({ where: { conceptId: { in: testConceptIds }, addedFrom: 'test-fixture' } });
      }
    }, 60_000);
  });
});
