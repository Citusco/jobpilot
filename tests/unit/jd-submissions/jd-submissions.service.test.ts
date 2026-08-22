import { jest } from '@jest/globals';

import type { ExtractResponse } from '../../../src/agent-orchestration/schemas/extract-response.schema.js';
import { AgentOrchestrationUnavailableError } from '../../../src/agent-orchestration/agent-orchestration.client.js';
import { JdSubmissionsService } from '../../../src/jd-submissions/jd-submissions.service.js';
import { ResolveService } from '../../../src/resolve/resolve.service.js';

interface TermRow {
  term: string;
  conceptId: string;
}

interface StoredItem {
  surface: string;
  normalized: string;
  evidence: string[];
  conceptId: string | null;
  tier: string;
  score: number | null;
}

// The contract test covers the HTTP surface. This one covers the service's own
// merging behaviour, where the interesting cases are the ones a posting produces
// rarely enough that they are easy to get wrong and never notice.
describe('JdSubmissionsService', () => {
  const buildDeps = (terms: TermRow[] = []) => {
    const extract = jest.fn<(text: string) => Promise<ExtractResponse>>();
    const create = jest.fn<(args: unknown) => Promise<{ id: string }>>().mockResolvedValue({
      id: 'submission-1',
    });
    // Tier 1 reads `concept_terms` twice: the exact lookup (`where`), then the whole
    // term index for anything that missed. These cases are about merging and storage, so
    // the index comes back empty and the containment pass can never fire.
    const findMany = jest
      .fn<(args: { where?: unknown }) => Promise<TermRow[]>>()
      .mockImplementation(async (args) => (args?.where === undefined ? [] : terms));
    const prisma = { jdSubmission: { create }, conceptTerm: { findMany } };
    const service = new JdSubmissionsService(
      { extract } as never,
      new ResolveService(prisma as never),
      prisma as never,
    );
    return { extract, create, findMany, service };
  };

  const storedItems = (create: ReturnType<typeof jest.fn>): StoredItem[] =>
    (create.mock.calls[0][0] as { data: { items: { create: StoredItem[] } } }).data.items.create;

  it('stores one item per distinct normalized phrase, in first-mention order', async () => {
    const { extract, create, service } = buildDeps();
    extract.mockResolvedValue({
      items: [
        { surface: 'Kubernetes', evidence: ['a'] },
        { surface: 'CQRS', evidence: ['b'] },
        { surface: 'kubernetes', evidence: ['c'] },
      ],
    });

    const result = await service.submit('text');

    expect(result.items.map((item) => item.surface)).toEqual(['Kubernetes', 'CQRS']);
    expect(storedItems(create as never).map((item) => item.normalized)).toEqual([
      'kubernetes',
      'cqrs',
    ]);
  });

  it('keeps the first surface form when two spellings merge', async () => {
    // One of the two has to be displayed; the posting's first use is as good a choice as
    // any, and picking deterministically is what matters.
    const { extract, service } = buildDeps();
    extract.mockResolvedValue({
      items: [
        { surface: 'Rate Limiting', evidence: ['a'] },
        { surface: 'rate-limiting', evidence: ['b'] },
      ],
    });

    const result = await service.submit('text');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].surface).toBe('Rate Limiting');
  });

  it('accumulates distinct evidence spans across merged mentions', async () => {
    const { extract, service } = buildDeps();
    extract.mockResolvedValue({
      items: [
        { surface: 'Kubernetes', evidence: ['first mention'] },
        { surface: 'Kubernetes', evidence: ['second mention'] },
      ],
    });

    const result = await service.submit('text');

    expect(result.items[0].evidence).toEqual(['first mention', 'second mention']);
  });

  it('does not store the same evidence span twice', async () => {
    const { extract, service } = buildDeps();
    extract.mockResolvedValue({
      items: [
        { surface: 'Kubernetes', evidence: ['same span', 'same span'] },
        { surface: 'kubernetes', evidence: ['same span'] },
      ],
    });

    const result = await service.submit('text');

    expect(result.items[0].evidence).toEqual(['same span']);
  });

  it('records the resolution outcome on the stored row, with no score for an exact match', async () => {
    const { extract, create, service } = buildDeps([{ term: 'cqrs', conceptId: 'cqrs' }]);
    extract.mockResolvedValue({
      items: [
        { surface: 'CQRS', evidence: ['a'] },
        { surface: 'Kubernetes', evidence: ['b'] },
      ],
    });

    await service.submit('text');

    expect(storedItems(create as never)).toEqual([
      {
        surface: 'CQRS',
        normalized: 'cqrs',
        evidence: ['a'],
        conceptId: 'cqrs',
        tier: 'exact',
        score: null,
      },
      {
        surface: 'Kubernetes',
        normalized: 'kubernetes',
        evidence: ['b'],
        conceptId: null,
        tier: 'unresolved',
        score: null,
      },
    ]);
  });

  it('stores a submission with no items rather than refusing it', async () => {
    const { extract, create, service } = buildDeps();
    extract.mockResolvedValue({ items: [] });

    const result = await service.submit('a friendly team');

    expect(result.summary).toEqual({
      total: 0,
      exact: 0,
      containment: 0,
      similarity: 0,
      unresolved: 0,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(storedItems(create as never)).toEqual([]);
  });

  it('persists nothing when extraction fails', async () => {
    const { extract, create, service } = buildDeps();
    extract.mockRejectedValue(new AgentOrchestrationUnavailableError('unreachable'));

    await expect(service.submit('text')).rejects.toThrow(AgentOrchestrationUnavailableError);
    expect(create).not.toHaveBeenCalled();
  });

  it('produces at most one item for phrases that all normalise to nothing', async () => {
    // Two different pieces of punctuation both normalise to the empty string. Storing
    // both would violate @@unique([submissionId, normalized]) at the database.
    const { extract, create, service } = buildDeps();
    extract.mockResolvedValue({
      items: [
        { surface: '///', evidence: ['a'] },
        { surface: '---', evidence: ['b'] },
      ],
    });

    await service.submit('text');

    expect(storedItems(create as never)).toHaveLength(1);
    expect(storedItems(create as never)[0].tier).toBe('unresolved');
  });
});
