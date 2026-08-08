import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../../src/generated/prisma/client.js';
import { ingestCandidates, ingestChunks, type ChunkLine, type CandidateLine } from '../../scripts/ingest-corpus.js';

// Requires a real (test) Postgres database reachable via DATABASE_URL, with
// the Concept/DocChunk migration applied — see quickstart.md. Each test uses
// its own randomly-generated conceptId so tests never collide with each
// other or with real corpus data, and cleans up after itself.
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
    it('inserts DocChunk rows for a seeded Concept fixture, independent of candidate generation (US3)', async () => {
      await prisma.concept.create({
        data: {
          conceptId: testConceptId,
          name: 'Test Concept',
          aliases: [],
          kind: 'architecture',
          related: [],
          status: 'candidate',
          addedFrom: 'test-fixture',
        },
      });

      const chunk: ChunkLine = {
        chunkId: `test:${testConceptId}:cost:example`,
        patternId: testConceptId,
        kind: 'cost',
        label: 'Example',
        content: 'This is verbatim test content.',
        contextPrefix: '[Test Concept pattern / Example]',
        sourceUrl: 'https://example.com/test',
        citable: true,
        kindConfidence: 'regex',
        docDate: null,
        contentHash: 'hash-v1',
        sourceFile: 'test.md',
      };

      await ingestChunks(prisma, [chunk]);

      const rows = await prisma.docChunk.findMany({ where: { patternId: testConceptId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].content).toBe('This is verbatim test content.');
      expect(rows[0].contextPrefix).toBe('[Test Concept pattern / Example]');

      const concept = await prisma.concept.findUnique({ where: { conceptId: testConceptId } });
      expect(concept?.hasCorpus).toBe(true);
    });

    it('is idempotent: re-running with an unchanged content_hash is a true no-op (SC-002)', async () => {
      await prisma.concept.create({
        data: {
          conceptId: testConceptId,
          name: 'Test Concept',
          aliases: [],
          kind: 'architecture',
          related: [],
          status: 'candidate',
          addedFrom: 'test-fixture',
        },
      });
      const chunk: ChunkLine = {
        chunkId: `test:${testConceptId}:cost:example`,
        patternId: testConceptId,
        kind: 'cost',
        label: 'Example',
        content: 'Unchanged content.',
        contextPrefix: '[Test Concept pattern / Example]',
        sourceUrl: 'https://example.com/test',
        citable: true,
        kindConfidence: 'regex',
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
          aliases: [],
          kind: 'architecture',
          related: [],
          status: 'candidate',
          addedFrom: 'test-fixture',
        },
      });
      const v1: ChunkLine = {
        chunkId: `test:${testConceptId}:cost:example`,
        patternId: testConceptId,
        kind: 'cost',
        label: 'Example',
        content: 'Version one.',
        contextPrefix: '[Test Concept pattern / Example]',
        sourceUrl: 'https://example.com/test',
        citable: true,
        kindConfidence: 'regex',
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
          aliases: [],
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
});
