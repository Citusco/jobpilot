import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { AgentOrchestrationClient } from '../../src/agent-orchestration/agent-orchestration.client.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { ExtractResponse } from '../../src/agent-orchestration/schemas/extract-response.schema.js';

// End to end against the real corpus in Postgres: real Prisma, real concept_terms, real
// tier-1 resolution. Only the agent service is stubbed, because no test may call a
// provider -- and extraction is the one step that would. What is under test here is
// everything after it.
//
// Requires DATABASE_URL to point at a database with the corpus ingested (70 concepts,
// 147 terms as measured). US2 extends this file with the graph endpoint.

const JD_TEXT = [
  'Senior Backend Engineer.',
  'You will implement rate limiting on our public API, apply Throttling to protect',
  'downstream services, operate a Circuit Breaker around third-party calls, and run',
  'Kubernetes in production.',
  'Australian citizenship required. Sydney based. Salary from $180k.',
].join(' ');

const EXTRACTED: ExtractResponse = {
  items: [
    { surface: 'rate limiting', evidence: ['implement rate limiting on our public API'] },
    { surface: 'Throttling', evidence: ['apply Throttling to protect'] },
    { surface: 'Circuit Breaker', evidence: ['operate a Circuit Breaker around third-party calls'] },
    { surface: 'Kubernetes', evidence: ['run Kubernetes in production.'] },
  ],
};

interface GraphBody {
  submissionId: string;
  threshold: unknown;
  nodes: {
    id: string;
    conceptId: string | null;
    name: string;
    layer: 'named-resolved' | 'named-unanswered' | 'adjacent';
    relevance: number;
    matchedItems: string[];
    hasCorpus: boolean;
    evidence: string[];
  }[];
  edges: { a: string; b: string; kind: 'authored' | 'inferred'; strength: number }[];
  items: { surface: string; conceptId: string | null; tier: string; evidence: string[] }[];
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

interface ResponseItem {
  surface: string;
  conceptId: string | null;
  tier: string;
  score: number | null;
  evidence: string[];
}

describe('submit a posting through to stored items (integration)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;
  let extract: ReturnType<typeof jest.fn<(text: string) => Promise<ExtractResponse>>>;
  const submissionIds: string[] = [];

  const submit = async (text: string) => {
    const response = await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/jd-submissions')
      .send({ text });
    if (response.status === 201) submissionIds.push(response.body.submissionId as string);
    return response;
  };

  const graphOf = (submissionId: string) =>
    request(app.getHttpServer() as Parameters<typeof request>[0]).get(
      `/jd-submissions/${submissionId}/graph`,
    );

  beforeAll(async () => {
    await prisma.$connect();
    extract = jest.fn<(text: string) => Promise<ExtractResponse>>();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentOrchestrationClient)
      .useValue({ extract })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    // extracted_items cascades from the submission.
    await prisma.jdSubmission.deleteMany({ where: { id: { in: submissionIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    extract.mockReset().mockResolvedValue(EXTRACTED);
  });

  it('uses a fixture whose evidence spans are genuinely quoted from the posting', () => {
    // The stub bypasses the Zod schema that normally enforces this at the boundary, so
    // the fixture has to hold itself to the same rule -- otherwise this file could pass
    // while asserting on evidence that no real response could ever carry.
    for (const item of EXTRACTED.items) {
      for (const span of item.evidence) {
        expect(JD_TEXT).toContain(span);
      }
    }
  });

  it('recovers the eight phrases the exact tier missed, against the real term index', async () => {
    // Measured on a real posting: 8 of its 29 unresolved items literally contained a
    // registered concept name. This is the same list, run against the corpus as it
    // actually stands rather than against a fixture term table -- the exclusion of the
    // navigation pages and the longest-match rule both depend on the real 147 terms.
    const phrases = [
      ['ambassador patterns', 'ambassador'],
      ['compensating transaction handling', 'compensating-transaction'],
      ['event-driven flows', 'event-driven'],
      ['microservices estate', 'microservices'],
      ['publisher-subscriber topology', 'publisher-subscriber'],
      ['REST API design', 'api-design'],
      ['retry patterns', 'retry'],
      ['strangler fig approach', 'strangler-fig'],
    ];
    const text = phrases.map(([surface]) => `We use ${surface} here.`).join(' ');
    extract.mockResolvedValue({
      items: phrases.map(([surface]) => ({ surface, evidence: [`We use ${surface} here.`] })),
    });

    const response = await submit(text);

    expect(response.status).toBe(201);
    const items = response.body.items as ResponseItem[];
    expect(items.map((item) => [item.surface, item.conceptId])).toEqual(phrases);
    expect(items.every((item) => item.tier === 'containment')).toBe(true);
    expect(response.body.summary).toMatchObject({ total: 8, exact: 0, containment: 8 });
  });

  it('does not let the containment pass answer a product name', async () => {
    // Go, Kafka and Kubernetes are what a posting's unresolved list is mostly made of,
    // and none of them is a pattern. A containment pass that started attaching them to
    // something nearby would break the project's own alias rule silently.
    extract.mockResolvedValue({
      items: [
        { surface: 'Go', evidence: ['Go'] },
        { surface: 'Kafka', evidence: ['Kafka'] },
        { surface: 'GraphQL APIs', evidence: ['GraphQL APIs'] },
        { surface: 'Kubernetes operators', evidence: ['Kubernetes operators'] },
      ],
    });

    const response = await submit('Go Kafka GraphQL APIs Kubernetes operators');

    expect(response.status).toBe(201);
    const items = response.body.items as ResponseItem[];
    expect(items.map((item) => item.conceptId)).toEqual([null, null, null, null]);
  });

  it('resolves what the corpus covers and honestly reports what it does not', async () => {
    const response = await submit(JD_TEXT);

    expect(response.status).toBe(201);
    const items = response.body.items as ResponseItem[];
    expect(items.map((item) => [item.surface, item.conceptId, item.tier])).toEqual([
      ['rate limiting', 'rate-limiting', 'exact'],
      ['Throttling', 'throttling', 'exact'],
      ['Circuit Breaker', 'circuit-breaker', 'exact'],
      ['Kubernetes', null, 'unresolved'],
    ]);
    expect(response.body.summary).toEqual({
      total: 4,
      exact: 3,
      containment: 0,
      similarity: 0,
      unresolved: 1,
    });
  });

  it('resolves "rate limiting" to rate-limiting at tier 1, deterministically', async () => {
    // docs/DECISIONS.md, 2026-08-10: `rate-limiting` and `throttling` are separate
    // concepts -- client side and server side of one interaction -- and colloquially
    // "rate limiting" usually means what the corpus calls Throttling. The exact tier
    // cannot be overridden and must not be: it resolves the phrase as recorded, every
    // time, and the neighbouring concept surfaces through the graph instead.
    //
    // An exact match that is confidently wrong is the accepted cost of a tier that can
    // never be wrong about what was recorded. What this asserts is that the outcome does
    // not drift: same phrase, same concept, no score, twice.
    const first = await submit(JD_TEXT);
    const second = await submit(JD_TEXT);

    const rateLimiting = (body: { items: ResponseItem[] }) =>
      body.items.find((item) => item.surface === 'rate limiting');

    expect(rateLimiting(first.body)).toMatchObject({
      conceptId: 'rate-limiting',
      tier: 'exact',
      score: null,
    });
    expect(rateLimiting(second.body)).toEqual(rateLimiting(first.body));
  });

  it('keeps rate-limiting and throttling as distinct concepts in one posting', async () => {
    const response = await submit(JD_TEXT);
    const items = response.body.items as ResponseItem[];

    const conceptIds = items.map((item) => item.conceptId);
    expect(conceptIds).toContain('rate-limiting');
    expect(conceptIds).toContain('throttling');
  });

  it('stores the submission with its text and every item, retrievable afterwards', async () => {
    // SC-009. Nothing in this feature reads a submission back (FR-026) -- this test does,
    // to confirm the record that later coverage measurement will need is actually
    // accumulating from the first request.
    const response = await submit(JD_TEXT);

    const stored = await prisma.jdSubmission.findUnique({
      where: { id: response.body.submissionId as string },
      include: { items: { orderBy: { normalized: 'asc' } } },
    });

    expect(stored?.rawText).toBe(JD_TEXT);
    expect(stored?.items.map((item) => [item.normalized, item.conceptId, item.tier])).toEqual([
      ['circuitbreaker', 'circuit-breaker', 'exact'],
      ['kubernetes', null, 'unresolved'],
      ['ratelimiting', 'rate-limiting', 'exact'],
      ['throttling', 'throttling', 'exact'],
    ]);
    expect(stored?.items.every((item) => item.score === null)).toBe(true);
    expect(stored?.items.find((item) => item.normalized === 'kubernetes')?.evidence).toEqual([
      'run Kubernetes in production.',
    ]);
  });

  it('refuses a second row for the same phrase in one submission', async () => {
    // The unique constraint is the backstop behind the service's merging. A test can be
    // deleted; the constraint cannot.
    const response = await submit(JD_TEXT);

    await expect(
      prisma.extractedItem.create({
        data: {
          submissionId: response.body.submissionId as string,
          surface: 'Rate Limiting',
          normalized: 'ratelimiting',
          evidence: ['a second row for a phrase already recorded'],
          conceptId: 'rate-limiting',
          tier: 'exact',
        },
      }),
    ).rejects.toThrow();
  });

  it('accepts a posting with nothing the corpus covers rather than refusing it', async () => {
    extract.mockResolvedValue({
      items: [
        { surface: 'Kubernetes', evidence: ['run Kubernetes in production.'] },
        { surface: 'Terraform', evidence: ['run Kubernetes in production.'] },
      ],
    });

    const response = await submit(JD_TEXT);

    expect(response.status).toBe(201);
    expect(response.body.summary).toEqual({
      total: 2,
      exact: 0,
      containment: 0,
      similarity: 0,
      unresolved: 2,
    });
    expect((response.body.items as ResponseItem[]).every((item) => item.conceptId === null)).toBe(
      true,
    );
  });

  it('accepts a posting with no technical content at all', async () => {
    extract.mockResolvedValue({ items: [] });

    const response = await submit('We are a friendly team looking for a great person.');

    expect(response.status).toBe(201);
    expect(response.body.items).toEqual([]);

    const stored = await prisma.jdSubmission.findUnique({
      where: { id: response.body.submissionId as string },
      include: { items: true },
    });
    expect(stored?.items).toEqual([]);
  });

  describe('posting in, graph out', () => {
    it('draws the posting, not the corpus', async () => {
      const submission = await submit(JD_TEXT);
      const response = await graphOf(submission.body.submissionId as string);
      const body = response.body as GraphBody;

      expect(response.status).toBe(200);
      const named = body.nodes.filter((node) => node.layer !== 'adjacent');
      expect(named.map((node) => node.id).sort()).toEqual([
        'circuit-breaker',
        'item:kubernetes',
        'rate-limiting',
        'throttling',
      ]);
      // The corpus is far larger than this, and the map now says so in `stats` rather
      // than by drawing all of it.
      expect(body.stats.corpusConcepts).toBeGreaterThanOrEqual(67);
      expect(body.stats.offMap).toBeGreaterThan(0);
      expect(body.stats.nodes).toBeLessThan(body.stats.corpusConcepts);
    });

    it('puts Kubernetes on the map as an isolated point rather than in a side list', async () => {
      // It is a product name, so it must never become a concept and must never be
      // resolved to something nearby. It is still what the posting asked for, so it is
      // still on the map -- hollow, with no edges.
      const submission = await submit(JD_TEXT);
      const body = (await graphOf(submission.body.submissionId as string)).body as GraphBody;

      const node = body.nodes.find((n) => n.id === 'item:kubernetes');
      expect(node).toMatchObject({
        conceptId: null,
        name: 'Kubernetes',
        layer: 'named-unanswered',
        hasCorpus: false,
        evidence: ['run Kubernetes in production.'],
      });
      expect(body.edges.filter((e) => e.a === node!.id || e.b === node!.id)).toEqual([]);
    });

    it('carries the extracted item list, so a stored graph needs nothing else', async () => {
      // Until now the unresolved items lived only in the POST response, and reopening a
      // graph by id lost them -- the one thing the map is actually about.
      const submission = await submit(JD_TEXT);
      const body = (await graphOf(submission.body.submissionId as string)).body as GraphBody;

      expect(body.items.map((item) => [item.surface, item.tier])).toEqual([
        ['Circuit Breaker', 'exact'],
        ['Kubernetes', 'unresolved'],
        ['rate limiting', 'exact'],
        ['Throttling', 'exact'],
      ]);
    });

    it('gives a posting the corpus does not cover a map of its own, not the same one', async () => {
      // The measured failure this replaces: an uncovered posting produced an identical
      // 67-node map every time, carrying no information about the submission.
      extract.mockResolvedValue({
        items: [
          { surface: 'Kubernetes', evidence: ['run Kubernetes in production.'] },
          { surface: 'Terraform', evidence: ['run Kubernetes in production.'] },
        ],
      });
      const uncovered = await submit(JD_TEXT);
      const body = (await graphOf(uncovered.body.submissionId as string)).body as GraphBody;

      expect(body.nodes.map((node) => node.id)).toEqual(['item:kubernetes', 'item:terraform']);
      expect(body.edges).toEqual([]);
      expect(body.stats).toMatchObject({ namedResolved: 0, namedUnanswered: 2, adjacent: 0 });
    });

    it('is much smaller than the whole-corpus response it replaces', async () => {
      // The corpus map measured 34.5 KB. A posting's map is a fraction of it, which is
      // the point: the response is the submission, not the library.
      const submission = await submit(JD_TEXT);
      const response = await graphOf(submission.body.submissionId as string);

      const bytes = Buffer.byteLength(JSON.stringify(response.body), 'utf8');
      expect(bytes).toBeGreaterThan(1_000);
      expect(bytes).toBeLessThan(20_000);
    });

    it('keeps the adjacent layer to one hop, and every edge touching something named', async () => {
      const submission = await submit(JD_TEXT);
      const body = (await graphOf(submission.body.submissionId as string)).body as GraphBody;

      const named = new Set(
        body.nodes.filter((node) => node.layer !== 'adjacent').map((node) => node.id),
      );
      expect(body.edges.length).toBeGreaterThan(0);
      for (const edge of body.edges) {
        expect(named.has(edge.a) || named.has(edge.b)).toBe(true);
      }
      expect(body.stats.authoredEdges + body.stats.inferredEdges).toBe(body.edges.length);
    });

    it('puts throttling one edge from the rate-limiting the phrase resolved to', async () => {
      // The payoff for not overriding tier 1. "rate limiting" resolves to `rate-limiting`
      // exactly, while colloquially it usually means what the corpus calls Throttling
      // (docs/DECISIONS.md, 2026-08-10). The resolver stays deterministic and wrong-ish;
      // the graph is what puts the concept the candidate probably meant next to it.
      const submission = await submit(JD_TEXT);
      const body = (await graphOf(submission.body.submissionId as string)).body as GraphBody;

      const neighbours = body.edges
        .filter((edge) => edge.a === 'rate-limiting' || edge.b === 'rate-limiting')
        .map((edge) => (edge.a === 'rate-limiting' ? edge.b : edge.a));

      expect(neighbours).toContain('throttling');
    });

    it('returns the same graph for the same submission and different graphs for different ones', async () => {
      const first = await submit(JD_TEXT);
      const id = first.body.submissionId as string;

      expect((await graphOf(id)).text).toBe((await graphOf(id)).text);

      extract.mockResolvedValue({
        items: [{ surface: 'Kubernetes', evidence: ['run Kubernetes in production.'] }],
      });
      const second = await submit(JD_TEXT);
      const other = (await graphOf(second.body.submissionId as string)).body as GraphBody;

      // Different posting, different map. That is now the expected outcome, where
      // before the two submissions produced byte-identical node and edge lists.
      const original = (await graphOf(id)).body as GraphBody;
      expect(other.nodes.map((node) => node.id)).not.toEqual(
        original.nodes.map((node) => node.id),
      );
      expect(other.nodes.map((node) => node.id)).toEqual(['item:kubernetes']);
    });
  });
});
