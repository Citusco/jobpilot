import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  ingestCandidates,
  ingestChunks,
  ingestRelatedEdgeConcepts,
  ingestConceptTerms,
  type ChunkLine,
  type CandidateLine,
} from '../../scripts/ingest-corpus.js';

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

  describe('Related-edge concepts and concept_terms (User Story 2)', () => {
    const CANDIDATES_PATH = join(ROOT, 'corpus/_meta/candidates/azure.jsonl');

    function readRealCandidates(): CandidateLine[] {
      return readFileSync(CANDIDATES_PATH, 'utf-8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l));
    }

    afterEach(async () => {
      // ingestConceptTerms rebuilds the WHOLE table on every call, by design
      // (docs/DECISIONS.md 2026-08-10: rebuilds must not depend on leftover
      // rows from a previous run) -- so a test that calls it with synthetic
      // data must restore the real corpus's terms afterward, or every other
      // test/run sees a table missing the title-derived terms that only the
      // real candidate file carries.
      let realCandidates: CandidateLine[];
      try {
        realCandidates = readRealCandidates();
      } catch {
        return; // no real candidates file in this environment -- nothing to restore
      }
      if (realCandidates.length > 0) {
        await ingestConceptTerms(prisma, realCandidates);
      }
    });

    it('creates a related-edge concept as a candidate with no chunks, and is idempotent', async () => {
      const relatedId = `${testConceptId}-related`;
      const candidate: CandidateLine = {
        conceptId: testConceptId,
        name: 'Test Concept',
        kind: 'architecture',
        aliases: [],
        related: [relatedId],
        addedFrom: 'seed',
        sourceFile: 'test.md',
      };

      try {
        const createdFirst = await ingestRelatedEdgeConcepts(prisma, [candidate]);
        expect(createdFirst).toEqual([relatedId]);

        const row = await prisma.concept.findUnique({ where: { conceptId: relatedId } });
        expect(row?.status).toBe('candidate');
        expect(row?.hasCorpus).toBe(false);
        expect(row?.addedFrom).toBe('related-edge');
        const chunkCount = await prisma.docChunk.count({ where: { patternId: relatedId } });
        expect(chunkCount).toBe(0);

        const createdSecond = await ingestRelatedEdgeConcepts(prisma, [candidate]);
        expect(createdSecond).toEqual([]); // nothing new the second time

        const count = await prisma.concept.count({ where: { conceptId: relatedId } });
        expect(count).toBe(1); // not duplicated
      } finally {
        await prisma.concept.deleteMany({ where: { conceptId: relatedId } });
      }
    });

    it('reports every cross-concept term collision before failing, not just the first (FR-015)', async () => {
      // Two INDEPENDENT colliding pairs, not one: a .find()-style "stop at
      // the first collision" implementation would satisfy a single-pair
      // fixture just as well as the .filter()-style "collect every
      // collision" one FR-015 actually requires -- asserting on both pairs'
      // presence is what tells the two apart.
      const idA = `${testConceptId}-a`;
      const idB = `${testConceptId}-b`;
      const idC = `${testConceptId}-c`;
      const idD = `${testConceptId}-d`;
      const colliding: CandidateLine[] = [
        { conceptId: idA, name: 'Alpha Name', title: null, kind: 'architecture', aliases: [], related: [], addedFrom: 'seed', sourceFile: 'a.md' },
        { conceptId: idB, name: 'Alpha Name', title: null, kind: 'architecture', aliases: [], related: [], addedFrom: 'seed', sourceFile: 'b.md' },
        { conceptId: idC, name: 'Beta Name', title: null, kind: 'architecture', aliases: [], related: [], addedFrom: 'seed', sourceFile: 'c.md' },
        { conceptId: idD, name: 'Beta Name', title: null, kind: 'architecture', aliases: [], related: [], addedFrom: 'seed', sourceFile: 'd.md' },
      ];

      let thrown: unknown;
      try {
        await ingestConceptTerms(prisma, colliding);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toMatch(new RegExp(`${idA}.*${idB}|${idB}.*${idA}`, 's'));
      expect(message).toMatch(new RegExp(`${idC}.*${idD}|${idD}.*${idC}`, 's'));
    });

    it('produces identical term and concept rows across two consecutive full runs over the real corpus (FR-023, data-model.md invariant 4)', async () => {
      let realCandidates: CandidateLine[];
      try {
        realCandidates = readRealCandidates();
      } catch {
        console.warn('[test] corpus/_meta/candidates/azure.jsonl not present -- run chunk_azure.py first; skipping');
        return;
      }
      if (realCandidates.length === 0) return;

      // Row identity, not just row count: a bug that reassigns which
      // concept wins a within-concept precedence tie between runs would
      // preserve the total count while silently changing which concept a
      // term resolves to -- a count-only comparison would not catch that.
      const snapshotTerms = async () =>
        (await prisma.conceptTerm.findMany({ select: { term: true, conceptId: true, termType: true } }))
          .map((r) => `${r.term}|${r.conceptId}|${r.termType}`)
          .sort();
      const snapshotConcepts = async () =>
        (await prisma.concept.findMany({ select: { conceptId: true, status: true, addedFrom: true } }))
          .map((r) => `${r.conceptId}|${r.status}|${r.addedFrom}`)
          .sort();

      await ingestCandidates(prisma, realCandidates);
      await ingestRelatedEdgeConcepts(prisma, realCandidates);
      await ingestConceptTerms(prisma, realCandidates);
      const termsAfterFirst = await snapshotTerms();
      const conceptsAfterFirst = await snapshotConcepts();

      const createdSecond = await ingestRelatedEdgeConcepts(prisma, realCandidates);
      await ingestConceptTerms(prisma, realCandidates);
      const termsAfterSecond = await snapshotTerms();
      const conceptsAfterSecond = await snapshotConcepts();

      expect(createdSecond).toEqual([]);
      expect(termsAfterSecond).toEqual(termsAfterFirst);
      expect(conceptsAfterSecond).toEqual(conceptsAfterFirst);
    }, 30_000);
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

      // Every chunk id already in the table before this test runs. The cleanup below
      // removes only what this test added: `testConceptIds` is every real corpus
      // concept, so deleting by pattern id wiped the entire ingested corpus on every
      // `npm test` run -- concepts survived only because their delete is guarded by
      // `addedFrom: 'test-fixture'` and the chunk delete had no equivalent guard.
      const preexistingChunkIds = new Set(
        (
          await prisma.docChunk.findMany({
            where: { patternId: { in: testConceptIds } },
            select: { chunkId: true },
          })
        ).map((r) => r.chunkId),
      );

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
        // Leave the table as it was found: drop only chunk ids this test introduced.
        // On a populated database that is nothing at all -- ingestChunks is
        // content-hash keyed and rewrites the same rows. On an empty one it is all of
        // them, which is equally "as found".
        const addedChunkIds = (
          await prisma.docChunk.findMany({
            where: { patternId: { in: testConceptIds } },
            select: { chunkId: true },
          })
        )
          .map((r) => r.chunkId)
          .filter((id) => !preexistingChunkIds.has(id));
        if (addedChunkIds.length > 0) {
          await prisma.docChunk.deleteMany({ where: { chunkId: { in: addedChunkIds } } });
        }
        await prisma.concept.deleteMany({ where: { conceptId: { in: testConceptIds }, addedFrom: 'test-fixture' } });
      }
    }, 60_000);
  });
});
