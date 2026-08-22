import { jest } from '@jest/globals';

import { normalizeTerm } from '../../../src/corpus/normalize-term.js';
import { ResolveService } from '../../../src/resolve/resolve.service.js';

interface TermRow {
  term: string;
  conceptId: string;
}

// Tier 1 only. Everything the exact tier does not match is `unresolved` in this scope --
// the similarity tier arrives with its calibration (US3), because a similarity tier
// running against an uncalibrated threshold is what FR-016 forbids.
describe('ResolveService (tier 1)', () => {
  const buildDeps = (rows: TermRow[] = []) => {
    const findMany = jest.fn<(args: unknown) => Promise<TermRow[]>>().mockResolvedValue(rows);
    const queryRaw = jest.fn();
    const prisma = { conceptTerm: { findMany }, $queryRaw: queryRaw, $queryRawUnsafe: queryRaw };
    const service = new ResolveService(prisma as never);
    return { findMany, queryRaw, service };
  };

  it('resolves an exact normalised match to that one concept, with tier exact', async () => {
    const { service } = buildDeps([
      { term: 'queuebasedloadleveling', conceptId: 'queue-based-load-leveling' },
    ]);

    const [resolution] = await service.resolve(['Queue-Based Load Leveling']);

    expect(resolution.tier).toBe('exact');
    expect(resolution.conceptId).toBe('queue-based-load-leveling');
    expect(resolution.surface).toBe('Queue-Based Load Leveling');
  });

  it('leaves score null on an exact match rather than writing 1.0', async () => {
    // data-model.md: 1.0 would record a measurement that never happened. The distinction
    // is what lets a wrong resolution be traced to a recorded name rather than a score.
    const { service } = buildDeps([{ term: 'cqrs', conceptId: 'cqrs' }]);

    const [resolution] = await service.resolve(['CQRS']);

    expect(resolution.score).toBeNull();
  });

  it('returns unresolved with a null concept when nothing matches', async () => {
    const { service } = buildDeps([]);

    const [resolution] = await service.resolve(['Kubernetes']);

    expect(resolution.tier).toBe('unresolved');
    expect(resolution.conceptId).toBeNull();
    expect(resolution.score).toBeNull();
    expect(resolution.surface).toBe('Kubernetes');
  });

  it('never assigns the nearest concept to a phrase that did not match', async () => {
    // FR-008. The lookup returns a row for a different phrase entirely; the unmatched
    // one must not borrow it.
    const { service } = buildDeps([{ term: 'throttling', conceptId: 'throttling' }]);

    const resolutions = await service.resolve(['Throttling', 'Kubernetes']);

    expect(resolutions.map((r) => r.conceptId)).toEqual(['throttling', null]);
    expect(resolutions.map((r) => r.tier)).toEqual(['exact', 'unresolved']);
  });

  it('looks the phrase up through the shared normalizeTerm, not a local rule', async () => {
    // There is exactly one implementation of normalizeTerm, shared with the corpus term
    // index. A second one here would drift and produce lookups that silently return
    // nothing, so the expected query terms are computed with the same function.
    const { findMany, service } = buildDeps([]);

    await service.resolve(['Anti-Corruption Layer', 'Queue-Based Load Leveling!']);

    const args = findMany.mock.calls[0][0] as { where: { term: { in: string[] } } };
    expect(args.where.term.in).toEqual([
      normalizeTerm('Anti-Corruption Layer'),
      normalizeTerm('Queue-Based Load Leveling!'),
    ]);
    expect(args.where.term.in).toEqual(['anticorruptionlayer', 'queuebasedloadleveling']);
  });

  it('consults no similarity measure at tier 1', async () => {
    // FR-006: a tier-1 match is deterministic and must not depend on a vector, a
    // threshold, or an embedding call. The resolver is constructed with Prisma alone;
    // asserting that no raw query is issued catches a vector comparison sneaking in
    // through $queryRaw, which is the only way one could reach the database here.
    const { findMany, queryRaw, service } = buildDeps([{ term: 'cqrs', conceptId: 'cqrs' }]);

    await service.resolve(['CQRS', 'something the corpus has never heard of']);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('resolves two spellings of the same term to the same concept', async () => {
    const { service } = buildDeps([{ term: 'ratelimiting', conceptId: 'rate-limiting' }]);

    const resolutions = await service.resolve(['Rate Limiting', 'rate-limiting']);

    expect(resolutions.map((r) => r.conceptId)).toEqual(['rate-limiting', 'rate-limiting']);
    expect(resolutions.map((r) => r.tier)).toEqual(['exact', 'exact']);
  });

  it('carries the normalized form alongside the surface form', async () => {
    // Storing both is what lets a resolution be explained after the fact without
    // recomputing it (data-model.md).
    const { service } = buildDeps([{ term: 'ratelimiting', conceptId: 'rate-limiting' }]);

    const [resolution] = await service.resolve(['Rate Limiting']);

    expect(resolution).toMatchObject({ surface: 'Rate Limiting', normalized: 'ratelimiting' });
  });

  it('returns unresolved for a phrase that normalises to nothing', async () => {
    const { service } = buildDeps([]);

    const [resolution] = await service.resolve(['///']);

    expect(resolution.tier).toBe('unresolved');
    expect(resolution.conceptId).toBeNull();
  });

  it('issues no query at all for an empty input', async () => {
    const { findMany, service } = buildDeps([]);

    await expect(service.resolve([])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
