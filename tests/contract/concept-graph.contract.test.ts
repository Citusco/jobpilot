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
 * Against the real corpus rather than a fixture: the obligations are about which slice of
 * a 70-concept graph a submission selects, and a handful of stub rows cannot stand in for
 * that. Only the agent service is stubbed, and it is not called on this path at all --
 * the submission under test is inserted directly.
 *
 * The node set was every concept until 2026-08-22. It is now the posting's: what it named
 * and could be answered, what it named and nothing answers, and one hop out from the
 * first. What the corpus holds beyond that is reported as a count rather than drawn.
 */

type NodeLayer = 'named-resolved' | 'named-unanswered' | 'adjacent';

interface GraphNode {
  id: string;
  conceptId: string | null;
  name: string;
  layer: NodeLayer;
  hasCorpus: boolean;
  relevance: number;
  matchedItems: string[];
  evidence: string[];
}

interface GraphEdge {
  a: string;
  b: string;
  kind: 'authored' | 'inferred';
  strength: number;
}

interface GraphItem {
  surface: string;
  conceptId: string | null;
  tier: string;
  evidence: string[];
}

interface GraphBody {
  submissionId: string;
  threshold: { value: number; baseline: string; calibratedAt: string } | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  items: GraphItem[];
  stats: {
    nodes: number;
    authoredEdges: number;
    inferredEdges: number;
    meanDegree: number;
    inferredCut: number | null;
    namedResolved: number;
    namedUnanswered: number;
    adjacent: number;
    offMap: number;
    corpusConcepts: number;
  };
}

describe('GET /jd-submissions/:id/graph (contract)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;
  let submissionId: string;
  let conceptCount: number;

  const get = (id: string) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).get(`/jd-submissions/${id}/graph`);

  const body = async () => (await get(submissionId)).body as GraphBody;

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
    it('is built from the corpus this test assumes', () => {
      // Greater-or-equal rather than exactly 70 because tests/integration/ingest-corpus
      // creates and deletes concept fixtures, and Jest runs suites in parallel: an exact
      // count here is a race against another file, not a claim about the corpus.
      expect(conceptCount).toBeGreaterThanOrEqual(70);
    });

    it('draws the posting rather than the corpus', async () => {
      const graph = await body();

      expect(graph.submissionId).toBe(submissionId);
      // The submission named three things. The map is those three plus one hop, and the
      // rest of the corpus is a number, not 60 grey points.
      expect(graph.nodes.length).toBeLessThan(graph.stats.corpusConcepts);
      expect(graph.stats.corpusConcepts).toBeGreaterThanOrEqual(67);
      expect(graph.stats.offMap).toBe(
        graph.stats.corpusConcepts - graph.stats.namedResolved - graph.stats.adjacent,
      );
    });

    it('gives every node exactly one layer, and no fourth', async () => {
      const graph = await body();
      const layers: NodeLayer[] = ['named-resolved', 'named-unanswered', 'adjacent'];

      expect(graph.nodes.length).toBeGreaterThan(0);
      for (const node of graph.nodes) {
        expect(layers).toContain(node.layer);
      }
    });

    it('puts what the posting named and the corpus answers in named-resolved', async () => {
      const graph = await body();
      const named = graph.nodes.filter((node) => node.layer === 'named-resolved');

      expect(named.map((node) => node.id).sort()).toEqual(['circuit-breaker', 'throttling']);
      expect(named.every((node) => node.hasCorpus)).toBe(true);
      expect(named.every((node) => node.relevance === 1)).toBe(true);
      expect(graph.nodes.find((node) => node.id === 'throttling')?.matchedItems).toEqual([
        'Throttling',
      ]);
    });

    it('puts what the posting named and nothing answers on the map, hollow and isolated', async () => {
      // Kubernetes is a product name. It must never become a concept and must never be
      // resolved to a nearby one -- and it is still the posting's actual demand, so it is
      // a node. Its isolation is the correct reading, not a rendering failure.
      const graph = await body();
      const node = graph.nodes.find((n) => n.id === 'item:kubernetes');

      expect(node).toMatchObject({
        conceptId: null,
        name: 'Kubernetes',
        layer: 'named-unanswered',
        hasCorpus: false,
        evidence: ['plus Kubernetes.'],
      });
      expect(graph.edges.filter((e) => e.a === node!.id || e.b === node!.id)).toEqual([]);
    });

    it('puts a concept one hop from a named one in adjacent, at relevance 0', async () => {
      const graph = await body();
      const adjacent = graph.nodes.filter((node) => node.layer === 'adjacent');

      expect(adjacent.length).toBeGreaterThan(0);
      expect(adjacent.every((node) => node.relevance === 0)).toBe(true);
      expect(adjacent.every((node) => node.matchedItems.length === 0)).toBe(true);
      // Every one of them is reachable in one edge from something named.
      const named = new Set(
        graph.nodes.filter((node) => node.layer !== 'adjacent').map((node) => node.id),
      );
      for (const node of adjacent) {
        expect(
          graph.edges.some(
            (edge) =>
              (edge.a === node.id && named.has(edge.b)) ||
              (edge.b === node.id && named.has(edge.a)),
          ),
        ).toBe(true);
      }
    });

    it('draws no navigation page, whichever layer would have carried it (FR-023)', async () => {
      const graph = await body();

      for (const id of NON_CONCEPT_IDS) {
        expect(graph.nodes.map((node) => node.id)).not.toContain(id);
      }
    });

    it('returns unique, sorted node ids in one response, with no pagination', async () => {
      const graph = await body();
      const ids = graph.nodes.map((node) => node.id);

      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('still marks a concept with no material, so it is not shown with equal confidence', async () => {
      const graph = await body();

      expect(graph.nodes.some((node) => !node.hasCorpus)).toBe(true);
      expect(graph.nodes.some((node) => node.hasCorpus)).toBe(true);
    });
  });

  describe('items', () => {
    it('carries every extracted phrase with the pass that resolved it', async () => {
      // The map is the posting's, so the posting's own list travels with it. A graph
      // reopened by id used to lose the unresolved items entirely, which is the one thing
      // an uncovered posting's map is about.
      const graph = await body();

      expect(graph.items).toEqual([
        {
          surface: 'Circuit Breaker',
          conceptId: 'circuit-breaker',
          tier: 'exact',
          evidence: ['a Circuit Breaker around third-party calls'],
        },
        {
          surface: 'Kubernetes',
          conceptId: null,
          tier: 'unresolved',
          evidence: ['plus Kubernetes.'],
        },
        {
          surface: 'Throttling',
          conceptId: 'throttling',
          tier: 'exact',
          evidence: ['Throttling and a Circuit Breaker'],
        },
      ]);
    });
  });

  describe('edges', () => {
    it('states a kind on every edge and never merges the two (FR-012)', async () => {
      const graph = await body();
      const kinds = new Set(graph.edges.map((edge) => edge.kind));

      expect(kinds).toEqual(new Set(['authored', 'inferred']));

      const pair = (edge: GraphEdge) => `${edge.a}|${edge.b}`;
      const authored = new Set(graph.edges.filter((e) => e.kind === 'authored').map(pair));
      const inferred = graph.edges.filter((e) => e.kind === 'inferred').map(pair);
      expect(inferred.filter((key) => authored.has(key))).toEqual([]);
      expect(new Set(inferred).size).toBe(inferred.length);
    });

    it('carries a renderable strength: 1 for authored, the similarity for inferred', async () => {
      const graph = await body();

      for (const edge of graph.edges) {
        if (edge.kind === 'authored') expect(edge.strength).toBe(1);
        else expect(edge.strength).toBeLessThan(1);
        expect(Number.isFinite(edge.strength)).toBe(true);
      }
    });

    it('joins only concepts, and only where one end is something the posting named', async () => {
      // Edges between two adjacent concepts are two hops from the submission. Drawing
      // them makes the subordinate layer the densest thing on the map.
      const graph = await body();
      const drawn = new Set(graph.nodes.map((node) => node.id));
      const named = new Set(
        graph.nodes.filter((node) => node.layer !== 'adjacent').map((node) => node.id),
      );

      expect(graph.edges.length).toBeGreaterThan(0);
      for (const edge of graph.edges) {
        expect(drawn.has(edge.a)).toBe(true);
        expect(drawn.has(edge.b)).toBe(true);
        expect(named.has(edge.a) || named.has(edge.b)).toBe(true);
      }
    });

    it('infers no edge touching a concept with no material (FR-010 applied to edges)', async () => {
      // Measured before the rule: 69 of 240 inferred edges joined two grey concepts,
      // 28.7% against a random expectation of 8.1% -- the densest part of the map was the
      // part where every node opens to nothing. Grey concepts keep their authored edges,
      // which a document author wrote and which are real.
      const graph = await body();
      const grey = new Set(
        graph.nodes.filter((node) => node.conceptId !== null && !node.hasCorpus).map((n) => n.id),
      );

      expect(
        graph.edges.filter(
          (edge) => edge.kind === 'inferred' && (grey.has(edge.a) || grey.has(edge.b)),
        ),
      ).toEqual([]);
    });
  });

  describe('stats', () => {
    it('agrees with the payload it summarises, so a client need not recount', async () => {
      const graph = await body();
      const authored = graph.edges.filter((edge) => edge.kind === 'authored');
      const inferred = graph.edges.filter((edge) => edge.kind === 'inferred');

      expect(graph.stats.nodes).toBe(graph.nodes.length);
      expect(graph.stats.authoredEdges).toBe(authored.length);
      expect(graph.stats.inferredEdges).toBe(inferred.length);
      expect(graph.stats.meanDegree).toBeCloseTo(
        (2 * graph.edges.length) / graph.nodes.length,
        10,
      );
    });

    it('counts the three layers, and they add up to the node list', async () => {
      const graph = await body();
      const count = (layer: NodeLayer) => graph.nodes.filter((n) => n.layer === layer).length;

      expect(graph.stats.namedResolved).toBe(count('named-resolved'));
      expect(graph.stats.namedUnanswered).toBe(count('named-unanswered'));
      expect(graph.stats.adjacent).toBe(count('adjacent'));
      expect(
        graph.stats.namedResolved + graph.stats.namedUnanswered + graph.stats.adjacent,
      ).toBe(graph.nodes.length);
    });

    it('reports how much of the corpus this map does not draw', async () => {
      // Without this a small map reads as a broken corpus rather than as a posting the
      // corpus does not cover -- the difference between an empty result being legible
      // and being suspicious.
      const graph = await body();

      expect(graph.stats.offMap).toBeGreaterThan(0);
      expect(graph.stats.corpusConcepts).toBeGreaterThan(graph.stats.offMap);
    });
  });

  it('reports no threshold until a calibration has produced one', async () => {
    // contracts/http-api.md echoes the threshold with the baseline behind it. The
    // calibration has now run (docs/DECISIONS.md, 2026-08-22) and found no separation
    // between its baselines, so there is no threshold in force to echo -- and a
    // placeholder number is exactly the authoritative-looking fiction FR-018 and FR-019b
    // exist to prevent. This assertion changes when a calibration produces one.
    expect((await body()).threshold).toBeNull();
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
