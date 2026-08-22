import { jest } from '@jest/globals';

import { ResolveService } from '../../../src/resolve/resolve.service.js';

/**
 * Tier 1's second pass, wired into the resolver.
 *
 * The rule itself is tested in containment-match.test.ts. What is under test here is the
 * ordering (exact equality still owns any phrase it can answer), the tier the outcome
 * carries, and the standing prohibition the new pass must not breach: no vector, no
 * threshold, no provider call. A containment hit is still a table lookup.
 */

interface ExactRow {
  term: string;
  conceptId: string;
}

interface TermRow {
  displayTerm: string;
  conceptId: string;
}

const ALL_TERMS: TermRow[] = [
  { displayTerm: 'retry', conceptId: 'retry' },
  { displayTerm: 'Retry pattern', conceptId: 'retry' },
  { displayTerm: 'throttling', conceptId: 'throttling' },
  { displayTerm: 'rate-limiting', conceptId: 'rate-limiting' },
  { displayTerm: 'microservices', conceptId: 'microservices' },
  { displayTerm: 'patterns', conceptId: 'patterns' },
];

const buildDeps = (exactRows: ExactRow[] = [], terms: TermRow[] = ALL_TERMS) => {
  const findMany = jest
    .fn<(args: { where?: unknown }) => Promise<unknown[]>>()
    .mockImplementation(async (args) => (args?.where === undefined ? terms : exactRows));
  const queryRaw = jest.fn();
  const prisma = { conceptTerm: { findMany }, $queryRaw: queryRaw, $queryRawUnsafe: queryRaw };
  return { findMany, queryRaw, service: new ResolveService(prisma as never) };
};

describe('ResolveService: the containment pass', () => {
  it('resolves a phrase that contains a registered term, at tier containment', async () => {
    const { service } = buildDeps([]);

    const [resolution] = await service.resolve(['retry patterns']);

    expect(resolution.conceptId).toBe('retry');
    expect(resolution.tier).toBe('containment');
  });

  it('reports containment as its own tier, never as exact', async () => {
    // An exact hit and a containment hit are different claims. A wrong resolution has to
    // be traceable to the pass that produced it, so the two never share a label on the
    // way out -- see docs/DECISIONS.md for how the distinction survives into storage.
    const { service } = buildDeps([{ term: 'throttling', conceptId: 'throttling' }]);

    const resolutions = await service.resolve(['Throttling', 'microservices estate']);

    expect(resolutions.map((r) => r.tier)).toEqual(['exact', 'containment']);
  });

  it('leaves score null on a containment hit, exactly as on an exact one', async () => {
    // Nothing was measured. A number here would be the invented measurement FR-016
    // forbids, and the containment pass has no threshold precisely because it needs none.
    const { service } = buildDeps([]);

    const [resolution] = await service.resolve(['rate limiting middleware']);

    expect(resolution.score).toBeNull();
  });

  it('never runs when exact equality already answered the phrase', async () => {
    const { service } = buildDeps([{ term: 'retry', conceptId: 'retry' }]);

    const [resolution] = await service.resolve(['Retry']);

    expect(resolution.tier).toBe('exact');
    expect(resolution.conceptId).toBe('retry');
  });

  it('loads the term index only when something actually missed', async () => {
    const { findMany, service } = buildDeps([{ term: 'throttling', conceptId: 'throttling' }]);

    await service.resolve(['Throttling']);

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('leaves a phrase containing nothing registered unresolved', async () => {
    const { service } = buildDeps([]);

    const resolutions = await service.resolve(['Kubernetes', 'GraphQL', 'Go']);

    expect(resolutions.map((r) => r.tier)).toEqual([
      'unresolved',
      'unresolved',
      'unresolved',
    ]);
    expect(resolutions.map((r) => r.conceptId)).toEqual([null, null, null]);
  });

  it('consults no vector, no threshold and no embedding call to do it', async () => {
    // The concept vectors are only reachable through raw SQL. If the containment pass
    // ever grew a "nearest term" fallback it would have to come through here.
    const { queryRaw, service } = buildDeps([]);

    await service.resolve(['event-driven flows', 'something entirely unheard of']);

    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('stays unresolved where the phrase names two concepts, rather than guessing', async () => {
    const { service } = buildDeps([]);

    const [resolution] = await service.resolve(['throttling and rate limiting']);

    expect(resolution.tier).toBe('unresolved');
    expect(resolution.conceptId).toBeNull();
  });

  it('excludes the corpus navigation pages from the term index it matches against', async () => {
    // `patterns` is a registered term and it is longer than `retry`, so without the
    // exclusion the longest-wins rule hands `retry patterns` to an Azure
    // table-of-contents page. NON_CONCEPT_IDS was previously applied only where the graph
    // is derived; the containment pass is the second place that needs it.
    const { service } = buildDeps([]);

    const resolutions = await service.resolve(['retry patterns', 'cloud design patterns']);

    expect(resolutions.map((r) => r.conceptId)).toEqual(['retry', null]);
  });

  it('carries the normalized surface, not the matched term, in `normalized`', async () => {
    // `normalized` is the phrase's identity: it is half of the uniqueness constraint that
    // stops one posting producing two rows for the same phrase. Writing the matched term
    // into it would collapse two different phrases that hit the same concept into one.
    const { service } = buildDeps([]);

    const [resolution] = await service.resolve(['Retry Patterns']);

    expect(resolution).toMatchObject({ surface: 'Retry Patterns', normalized: 'retrypatterns' });
  });
});
