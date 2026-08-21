import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import {
  AgentOrchestrationClient,
  AgentOrchestrationUnavailableError,
  AgentOrchestrationUnreachableError,
} from '../../src/agent-orchestration/agent-orchestration.client.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import type { ExtractResponse } from '../../src/agent-orchestration/schemas/extract-response.schema.js';

const JD_TEXT =
  'We are hiring a Backend Engineer. Responsibilities include operating ' +
  'Queue-Based Load Leveling between services and running Kubernetes in production.';

interface TermRow {
  term: string;
  conceptId: string;
}

interface CreatedSubmission {
  id: string;
  rawText: string;
  createdAt: Date;
}

describe('POST /jd-submissions (contract)', () => {
  let app: INestApplication;
  let extract: ReturnType<typeof jest.fn<(text: string) => Promise<ExtractResponse>>>;
  let findMany: ReturnType<typeof jest.fn<(args: unknown) => Promise<TermRow[]>>>;
  let create: ReturnType<typeof jest.fn<(args: unknown) => Promise<CreatedSubmission>>>;

  const post = (body: unknown) =>
    request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/jd-submissions')
      .send(body);

  beforeAll(async () => {
    extract = jest.fn<(text: string) => Promise<ExtractResponse>>();
    findMany = jest.fn<(args: unknown) => Promise<TermRow[]>>();
    create = jest.fn<(args: unknown) => Promise<CreatedSubmission>>();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentOrchestrationClient)
      .useValue({ extract })
      .overrideProvider(PrismaService)
      .useValue({
        jdSubmission: { create },
        conceptTerm: { findMany },
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    extract.mockReset();
    findMany.mockReset().mockResolvedValue([]);
    create.mockReset().mockResolvedValue({
      id: 'submission-1',
      rawText: JD_TEXT,
      createdAt: new Date('2026-08-21T00:00:00.000Z'),
    });
  });

  describe('the per-item outcome', () => {
    it('returns 201 with one entry per item, each resolved or honestly unresolved', async () => {
      extract.mockResolvedValue({
        items: [
          {
            surface: 'Queue-Based Load Leveling',
            evidence: ['operating Queue-Based Load Leveling between services'],
          },
          { surface: 'Kubernetes', evidence: ['running Kubernetes in production'] },
        ],
      });
      findMany.mockResolvedValue([
        { term: 'queuebasedloadleveling', conceptId: 'queue-based-load-leveling' },
      ]);

      const response = await post({ text: JD_TEXT });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        submissionId: 'submission-1',
        items: [
          {
            surface: 'Queue-Based Load Leveling',
            conceptId: 'queue-based-load-leveling',
            tier: 'exact',
            score: null,
            evidence: ['operating Queue-Based Load Leveling between services'],
          },
          {
            surface: 'Kubernetes',
            conceptId: null,
            tier: 'unresolved',
            score: null,
            evidence: ['running Kubernetes in production'],
          },
        ],
        summary: { total: 2, exact: 1, similarity: 0, unresolved: 1 },
      });
    });

    it('gives every item exactly one of the three tiers, and no fourth state', async () => {
      // SC-002. An item with a concept and tier `unresolved`, or without a concept and
      // any other tier, is the shape FR-008 forbids.
      extract.mockResolvedValue({
        items: [
          { surface: 'CQRS', evidence: ['operating Queue-Based Load Leveling'] },
          { surface: 'Kubernetes', evidence: ['running Kubernetes in production'] },
        ],
      });
      findMany.mockResolvedValue([{ term: 'cqrs', conceptId: 'cqrs' }]);

      const { body } = await post({ text: JD_TEXT });

      for (const item of body.items as Array<{ tier: string; conceptId: string | null }>) {
        expect(['exact', 'similarity', 'unresolved']).toContain(item.tier);
        expect(item.conceptId === null).toBe(item.tier === 'unresolved');
      }
    });

    it('reports summary counts that add up to the item list', async () => {
      extract.mockResolvedValue({
        items: [
          { surface: 'CQRS', evidence: ['operating Queue-Based Load Leveling'] },
          { surface: 'Kubernetes', evidence: ['running Kubernetes in production'] },
          { surface: 'Terraform', evidence: ['running Kubernetes in production'] },
        ],
      });
      findMany.mockResolvedValue([{ term: 'cqrs', conceptId: 'cqrs' }]);

      const { body } = await post({ text: JD_TEXT });
      const summary = body.summary as Record<string, number>;

      expect(summary.exact + summary.similarity + summary.unresolved).toBe(summary.total);
      expect(summary.total).toBe((body.items as unknown[]).length);
      expect(summary).toEqual({ total: 3, exact: 1, similarity: 0, unresolved: 2 });
    });

    it('merges repeated mentions of one phrase into a single item keeping every occurrence', async () => {
      // FR-003. Two rows for the same phrase would also violate the unique constraint
      // on (submission_id, normalized), so this cannot be left to the database to catch.
      extract.mockResolvedValue({
        items: [
          { surface: 'Kubernetes', evidence: ['running Kubernetes in production'] },
          { surface: 'kubernetes', evidence: ['operating Queue-Based Load Leveling'] },
        ],
      });

      const { body } = await post({ text: JD_TEXT });

      expect(body.items).toHaveLength(1);
      expect((body.items as Array<{ evidence: string[] }>)[0].evidence).toEqual([
        'running Kubernetes in production',
        'operating Queue-Based Load Leveling',
      ]);
      expect(body.summary).toEqual({ total: 1, exact: 0, similarity: 0, unresolved: 1 });
    });
  });

  describe('no submission-level rejection', () => {
    it('accepts a posting with no technical content and returns an empty item list', async () => {
      // FR-004 and FR-022: the whole-submission sufficiency gate is gone. A posting with
      // nothing technical is a 201 with nothing in it, not a 422.
      extract.mockResolvedValue({ items: [] });

      const response = await post({ text: 'We are a friendly team looking for a great person.' });

      expect(response.status).toBe(201);
      expect(response.body.items).toEqual([]);
      expect(response.body.summary).toEqual({ total: 0, exact: 0, similarity: 0, unresolved: 0 });
    });

    it('accepts a posting the corpus does not cover, returning it all unresolved', async () => {
      // SC-007: "this corpus does not cover this role" is a correct outcome to report,
      // not a failure to refuse.
      extract.mockResolvedValue({
        items: [
          { surface: 'Kubernetes', evidence: ['running Kubernetes in production'] },
          { surface: 'Terraform', evidence: ['running Kubernetes in production'] },
        ],
      });
      findMany.mockResolvedValue([]);

      const response = await post({ text: JD_TEXT });

      expect(response.status).toBe(201);
      expect(response.body.summary).toEqual({ total: 2, exact: 0, similarity: 0, unresolved: 2 });
    });

    it('carries no trace of the removed pipeline in its response', async () => {
      extract.mockResolvedValue({ items: [] });

      const { body } = await post({ text: JD_TEXT });

      expect(body).not.toHaveProperty('status');
      expect(body).not.toHaveProperty('sufficient');
      expect(body).not.toHaveProperty('reason');
      expect(body).not.toHaveProperty('rejectionReason');
      expect(body).not.toHaveProperty('extraction');
      expect(body).not.toHaveProperty('directions');
    });

    it('never answers 422, the status the removed gate used', async () => {
      extract.mockResolvedValue({ items: [] });

      const response = await post({ text: 'x' });

      expect(response.status).not.toBe(422);
    });
  });

  describe('request validation', () => {
    it('returns 400 without calling the agent service when text is missing', async () => {
      const response = await post({});

      expect(response.status).toBe(400);
      expect(extract).not.toHaveBeenCalled();
    });

    it('returns 400 without calling the agent service when text is empty', async () => {
      const response = await post({ text: '' });

      expect(response.status).toBe(400);
      expect(extract).not.toHaveBeenCalled();
    });

    it('returns 400 without calling the agent service when text is only whitespace', async () => {
      const response = await post({ text: '   \n\t  ' });

      expect(response.status).toBe(400);
      expect(extract).not.toHaveBeenCalled();
    });

    it('rejects text beyond the length limit with a reason rather than truncating it', async () => {
      // FR-005. The failure mode this guards against is a silently shortened posting
      // whose missing half is never reported.
      const response = await post({ text: 'a'.repeat(20_001) });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ message: expect.any(String) });
      expect(extract).not.toHaveBeenCalled();
    });

    it('accepts text exactly at the length limit', async () => {
      extract.mockResolvedValue({ items: [] });

      const response = await post({ text: 'a'.repeat(20_000) });

      expect(response.status).toBe(201);
    });
  });

  describe('upstream failure', () => {
    it('returns 502 when the agent service returns a malformed result', async () => {
      extract.mockRejectedValue(new AgentOrchestrationUnavailableError('invalid response'));

      const response = await post({ text: JD_TEXT });

      expect(response.status).toBe(502);
    });

    it('returns 503 when the agent service is unreachable', async () => {
      extract.mockRejectedValue(new AgentOrchestrationUnreachableError('connection refused'));

      const response = await post({ text: JD_TEXT });

      expect(response.status).toBe(503);
    });

    it('stores nothing when extraction fails', async () => {
      // contracts/http-api.md: a submission stored with an empty item list on error is
      // indistinguishable from a posting that genuinely had no technical content.
      extract.mockRejectedValue(new AgentOrchestrationUnavailableError('invalid response'));

      await post({ text: JD_TEXT });

      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('persistence', () => {
    it('stores the submission text with its items and their resolution outcomes', async () => {
      extract.mockResolvedValue({
        items: [
          {
            surface: 'Queue-Based Load Leveling',
            evidence: ['operating Queue-Based Load Leveling between services'],
          },
          { surface: 'Kubernetes', evidence: ['running Kubernetes in production'] },
        ],
      });
      findMany.mockResolvedValue([
        { term: 'queuebasedloadleveling', conceptId: 'queue-based-load-leveling' },
      ]);

      await post({ text: JD_TEXT });

      expect(create).toHaveBeenCalledTimes(1);
      const args = create.mock.calls[0][0] as {
        data: {
          rawText: string;
          items: {
            create: Array<{
              surface: string;
              normalized: string;
              conceptId: string | null;
              tier: string;
              score: number | null;
            }>;
          };
        };
      };
      expect(args.data.rawText).toBe(JD_TEXT);
      expect(args.data.items.create).toEqual([
        {
          surface: 'Queue-Based Load Leveling',
          normalized: 'queuebasedloadleveling',
          evidence: ['operating Queue-Based Load Leveling between services'],
          conceptId: 'queue-based-load-leveling',
          tier: 'exact',
          score: null,
        },
        {
          surface: 'Kubernetes',
          normalized: 'kubernetes',
          evidence: ['running Kubernetes in production'],
          conceptId: null,
          tier: 'unresolved',
          score: null,
        },
      ]);
    });

    it('stores the trimmed text that was actually extracted from', async () => {
      extract.mockResolvedValue({ items: [] });

      await post({ text: `  ${JD_TEXT}  ` });

      const args = create.mock.calls[0][0] as { data: { rawText: string } };
      expect(args.data.rawText).toBe(JD_TEXT);
      expect(extract).toHaveBeenCalledWith(JD_TEXT);
    });
  });
});
