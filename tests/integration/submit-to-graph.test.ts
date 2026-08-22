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
  nodes: { conceptId: string; relevance: number; matchedItems: string[]; hasCorpus: boolean }[];
  edges: { a: string; b: string; kind: 'authored' | 'inferred'; strength: number }[];
  stats: {
    nodes: number;
    authoredEdges: number;
    inferredEdges: number;
    meanDegree: number;
    inferredCut: number | null;
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
    expect(response.body.summary).toEqual({ total: 4, exact: 3, similarity: 0, unresolved: 1 });
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
    expect(response.body.summary).toEqual({ total: 2, exact: 0, similarity: 0, unresolved: 2 });
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
    it('turns the posting into a complete map, matched few and unmatched many alike', async () => {
      const submission = await submit(JD_TEXT);
      const response = await graphOf(submission.body.submissionId as string);
      const body = response.body as GraphBody;

      expect(response.status).toBe(200);
      const matched = body.nodes.filter((node) => node.matchedItems.length > 0);
      expect(matched.map((node) => node.conceptId).sort()).toEqual([
        'circuit-breaker',
        'rate-limiting',
        'throttling',
      ]);
      expect(matched.every((node) => node.relevance === 1)).toBe(true);
      // Kubernetes resolved to nothing, so it is on no node. The unmatched concepts are
      // the majority of the map and are the informative part of it.
      expect(body.nodes.filter((node) => node.relevance === 0).length).toBe(
        body.nodes.length - matched.length,
      );
    });

    it('fits in one response of roughly the measured size', async () => {
      const submission = await submit(JD_TEXT);
      const response = await graphOf(submission.body.submissionId as string);

      // The plan recorded 12.4 KB for "the whole graph serialised". The response as
      // contracts/http-api.md specifies it measures about 35 KB, and the difference is
      // the contract rather than the graph: 12.4 KB is roughly what the node ids and
      // edge pairs alone come to, while the response also carries a name, a corpus flag,
      // a relevance and a matched-item list per node, and `kind` plus `strength` on each
      // of ~345 edges. That is around 83 bytes an edge, all of it required.
      //
      // The conclusion the figure supported still holds -- one response, no pagination,
      // no subgraph parameter -- so the bound here is the measured size rather than the
      // planned one. What it guards is that nobody quietly adds per-node payload.
      const bytes = Buffer.byteLength(JSON.stringify(response.body), 'utf8');
      expect(bytes).toBeGreaterThan(25_000);
      expect(bytes).toBeLessThan(45_000);
    });

    it('holds the density target on the real corpus (FR-013)', async () => {
      const submission = await submit(JD_TEXT);
      const body = (await graphOf(submission.body.submissionId as string)).body as GraphBody;

      const degree = new Map(body.nodes.map((node) => [node.conceptId, 0]));
      for (const edge of body.edges) {
        degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
        degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
      }

      expect(body.stats.meanDegree).toBeCloseTo(10, 1);
      // `test-concept-*` rows belong to tests/integration/ingest-corpus, which runs in
      // parallel and creates them without a vector; one of those is legitimately
      // unconnectable and says nothing about the corpus.
      expect(
        [...degree.entries()].filter(
          ([id, count]) => count === 0 && !id.startsWith('test-concept-'),
        ),
      ).toEqual([]);
      expect(body.stats.authoredEdges).toBeGreaterThan(0);
      expect(body.stats.inferredEdges).toBeGreaterThan(body.stats.authoredEdges);
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

      // Same corpus, so the same nodes and the same edges -- only relevance moves.
      expect(other.stats).toEqual(((await graphOf(id)).body as GraphBody).stats);
      expect(other.nodes.every((node) => node.relevance === 0)).toBe(true);
    });
  });
});
