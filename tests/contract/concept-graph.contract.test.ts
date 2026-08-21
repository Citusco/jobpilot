import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { AgentOrchestrationClient } from '../../src/agent-orchestration/agent-orchestration.client.js';
import { NON_CONCEPT_IDS } from '../../src/corpus/non-concept-ids.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * GET /jd-submissions/:id/graph (contracts/http-api.md).
 *
 * Against the real corpus rather than a fixture: the obligations are "every concept" and
 * a density measured on the 70 real vectors, neither of which a handful of stub rows can
 * stand in for. Only the agent service is stubbed, and it is not called on this path at
 * all -- the submission under test is inserted directly.
 */

interface GraphNode {
  conceptId: string;
  name: string;
  hasCorpus: boolean;
  relevance: number;
  matchedItems: string[];
}

interface GraphEdge {
  a: string;
  b: string;
  kind: 'authored' | 'inferred';
  strength: number;
}

interface GraphBody {
  submissionId: string;
  threshold: { value: number; baseline: string; calibratedAt: string } | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodes: number;
    authoredEdges: number;
    inferredEdges: number;
    meanDegree: number;
    inferredCut: number | null;
  };
}

describe('GET /jd-submissions/:id/graph (contract)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;
  let submissionId: string;
  let conceptCount: number;

  const conceptIds = async () =>
    new Set(
      (await prisma.concept.findMany({ select: { conceptId: true } })).map(
        (concept) => concept.conceptId,
      ),
    );

  const get = (id: string) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).get(`/jd-submissions/${id}/graph`);

  beforeAll(async () => {
    await prisma.$connect();
    conceptCount = await prisma.concept.count();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentOrchestrationClient)
      .useValue({ extract: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const submission = await prisma.jdSubmission.create({
      data: {
        rawText: 'Throttling and a Circuit Breaker around third-party calls, plus Kubernetes.',
        items: {
          create: [
            {
              surface: 'Circuit Breaker',
              normalized: 'circuitbreaker',
              evidence: ['a Circuit Breaker around third-party calls'],
              conceptId: 'circuit-breaker',
              tier: 'exact',
            },
            {
              surface: 'Kubernetes',
              normalized: 'kubernetes',
              evidence: ['plus Kubernetes.'],
              conceptId: null,
              tier: 'unresolved',
            },
            {
              surface: 'Throttling',
              normalized: 'throttling',
              evidence: ['Throttling and a Circuit Breaker'],
              conceptId: 'throttling',
              tier: 'exact',
            },
          ],
        },
      },
    });
    submissionId = submission.id;
  });

  afterAll(async () => {
    await prisma.jdSubmission.delete({ where: { id: submissionId } });
    await app.close();
    await prisma.$disconnect();
  });

  describe('nodes', () => {
    it('carries every concept the corpus holds, minus the entries that are not concepts', () => {
      // FR-011 is "every concept", and FR-023 says a navigation page admitted through a
      // `related` edge is not one. 70 rows, one of which is `index`.
      //
      // Greater-or-equal rather than exactly 70 because tests/integration/ingest-corpus
      // creates and deletes concept fixtures, and Jest runs suites in parallel: an exact
      // count here is a race against another file, not a claim about the corpus.
      expect(conceptCount).toBeGreaterThanOrEqual(70);
    });

    it('returns them all in one response, sorted, with no pagination', async () => {
      // Sandwich the request between two reads so the transient fixtures another suite
      // may be creating cannot make this flaky: the node set must contain everything
      // that existed throughout, and nothing that existed at neither end.
      const idsBefore = await conceptIds();
      const response = await get(submissionId);
      const idsAfter = await conceptIds();
      const body = response.body as GraphBody;
      const nodeIds = body.nodes.map((node) => node.conceptId);

      expect(response.status).toBe(200);
      expect(body.submissionId).toBe(submissionId);
      expect(nodeIds).toEqual([...nodeIds].sort());
      expect(new Set(nodeIds).size).toBe(nodeIds.length);

      const throughout = [...idsBefore].filter((id) => idsAfter.has(id));
      expect(throughout.length).toBeGreaterThanOrEqual(70);
      for (const id of throughout) {
        if (NON_CONCEPT_IDS.has(id)) expect(nodeIds).not.toContain(id);
        else expect(nodeIds).toContain(id);
      }
      for (const id of nodeIds) {
        expect(idsBefore.has(id) || idsAfter.has(id)).toBe(true);
      }
    });

    it('includes concepts nothing resolved to, at relevance 0 (FR-011)', async () => {
      const body = (await get(submissionId)).body as GraphBody;
      const unmatched = body.nodes.filter((node) => node.matchedItems.length === 0);

      // The whole point of the map: what the posting did *not* mention has to be
      // visible, so this is the majority of the graph, not an omission.
      expect(unmatched.length).toBeGreaterThan(60);
      expect(unmatched.every((node) => node.relevance === 0)).toBe(true);
    });

    it('gives a concept the posting named its matched items and full relevance', async () => {
      const body = (await get(submissionId)).body as GraphBody;

      expect(body.nodes.find((node) => node.conceptId === 'throttling')).toMatchObject({
        name: expect.any(String),
        hasCorpus: true,
        relevance: 1,
        matchedItems: ['Throttling'],
      });
      // An unresolved item attaches to nothing -- there is no nearest concept to put it
      // on (FR-008), so `Kubernetes` appears in no node's matchedItems.
      expect(body.nodes.some((node) => node.matchedItems.includes('Kubernetes'))).toBe(false);
    });

    it('marks concepts with no material, so they are not shown with equal confidence', async () => {
      const body = (await get(submissionId)).body as GraphBody;
      const grey = body.nodes.filter((node) => !node.hasCorpus);

      expect(grey.length).toBeGreaterThan(0);
      expect(grey.length).toBeLessThan(body.nodes.length);
    });
  });

  describe('edges', () => {
    it('states a kind on every edge and never merges the two (FR-012)', async () => {
      const body = (await get(submissionId)).body as GraphBody;
      const kinds = new Set(body.edges.map((edge) => edge.kind));

      expect(kinds).toEqual(new Set(['authored', 'inferred']));

      const pair = (edge: GraphEdge) => `${edge.a}|${edge.b}`;
      const authored = new Set(body.edges.filter((e) => e.kind === 'authored').map(pair));
      const inferred = body.edges.filter((e) => e.kind === 'inferred').map(pair);
      expect(inferred.filter((key) => authored.has(key))).toEqual([]);
      expect(new Set(inferred).size).toBe(inferred.length);
    });

    it('carries a renderable strength: 1 for authored, the similarity for inferred', async () => {
      const body = (await get(submissionId)).body as GraphBody;

      for (const edge of body.edges) {
        if (edge.kind === 'authored') expect(edge.strength).toBe(1);
        else expect(edge.strength).toBeLessThan(1);
        expect(Number.isFinite(edge.strength)).toBe(true);
      }
    });

    it('infers no edge touching a concept with no material, but keeps its authored ones', async () => {
      // The same reasoning FR-010 applies to matching, applied to edges: a vector built
      // from a name alone must not be judged on the footing of one built from real text.
      // Measured before the rule: 69 of 240 inferred edges joined two grey concepts,
      // 28.7% against a random expectation of 8.1%, so the densest part of the map was
      // the part where every node opens to nothing.
      const body = (await get(submissionId)).body as GraphBody;
      const grey = new Set(
        body.nodes.filter((node) => !node.hasCorpus).map((node) => node.conceptId),
      );

      expect(grey.size).toBeGreaterThan(0);
      expect(
        body.edges.filter(
          (edge) => edge.kind === 'inferred' && (grey.has(edge.a) || grey.has(edge.b)),
        ),
      ).toEqual([]);

      // Still nodes, and still connected -- dropping them would hide the fact that the
      // corpus knows of these concepts and has nothing behind them.
      for (const id of grey) {
        const touching = body.edges.filter((edge) => edge.a === id || edge.b === id);
        expect(touching.length).toBeGreaterThan(0);
        expect(touching.every((edge) => edge.kind === 'authored')).toBe(true);
      }
    });

    it('reaches the density target with no concept left unconnected (FR-013)', async () => {
      const body = (await get(submissionId)).body as GraphBody;

      const degree = new Map(body.nodes.map((node) => [node.conceptId, 0]));
      for (const edge of body.edges) {
        degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
        degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
      }

      expect(body.stats.meanDegree).toBeCloseTo(10, 1);
      // `test-concept-*` rows belong to tests/integration/ingest-corpus, which runs in
      // parallel and creates them without a vector. One of those is legitimately
      // unconnectable; the claim here is about the corpus, not about another suite's
      // fixtures happening to overlap this request.
      expect(
        [...degree.entries()].filter(
          ([id, count]) => count === 0 && !id.startsWith('test-concept-'),
        ),
      ).toEqual([]);
      // Both endpoints of every edge are nodes, or a client cannot draw it.
      expect(degree.size).toBe(body.nodes.length);
    });
  });

  describe('stats', () => {
    it('agrees with the payload it summarises, so a client need not recount', async () => {
      const body = (await get(submissionId)).body as GraphBody;
      const authored = body.edges.filter((edge) => edge.kind === 'authored');
      const inferred = body.edges.filter((edge) => edge.kind === 'inferred');

      expect(body.stats.nodes).toBe(body.nodes.length);
      expect(body.stats.authoredEdges).toBe(authored.length);
      expect(body.stats.inferredEdges).toBe(inferred.length);
      expect(body.stats.meanDegree).toBeCloseTo((2 * body.edges.length) / body.nodes.length, 10);
      expect(body.stats.inferredCut).toBe(
        Math.min(...inferred.map((edge) => edge.strength)),
      );
    });
  });

  it('reports no threshold until a calibration has produced one', async () => {
    // contracts/http-api.md echoes the threshold with the baseline behind it. US3 has not
    // run yet, so there is nothing to echo -- and a placeholder number is exactly the
    // authoritative-looking fiction FR-018 and FR-019b exist to prevent.
    const body = (await get(submissionId)).body as GraphBody;
    expect(body.threshold).toBeNull();
  });

  it('returns 404 for a submission that does not exist', async () => {
    expect((await get('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    // A malformed id names no submission either, and saying "not found" is the honest
    // answer rather than letting the database driver raise.
    expect((await get('not-a-uuid')).status).toBe(404);
  });

  it('returns an identical response on every request for the same submission (FR-015)', async () => {
    const [first, second] = [await get(submissionId), await get(submissionId)];

    expect(second.body).toEqual(first.body);
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
  });
});
