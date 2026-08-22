import { jest } from '@jest/globals';

import { CALIBRATION, SIMILARITY_THRESHOLD } from '../../../src/resolve/calibration.js';
import { ResolveService } from '../../../src/resolve/resolve.service.js';

/**
 * The similarity tier, and why there is not one.
 *
 * T020/T021 planned tier 2 against a calibrated threshold. The calibration ran
 * (docs/calibration/resolve-threshold.json, docs/DECISIONS.md 2026-08-22) and found no
 * separation between its baselines: the matching distribution's p5 is 0.1921 against the
 * non-matching distribution's p95 of 0.5092, and the concept a phrase was taken from is
 * the strongest match for only 50 of 147 phrases. FR-018 says that outcome is reported,
 * not worked around, and FR-016 says the threshold comes from the measurement.
 *
 * So these are the assertions that keep tier 2 from arriving anyway. They are not
 * placeholders for the tier-2 tests -- they are the tests for the state the measurement
 * put the system in, and the first of them fails the moment a calibration produces a
 * number, which is the signal to write the tier-2 tests for real.
 */
describe('ResolveService: the similarity tier', () => {
  const buildService = () => {
    const findMany = jest
      .fn<(args: unknown) => Promise<Array<{ term: string; conceptId: string }>>>()
      .mockResolvedValue([]);
    const queryRaw = jest.fn();
    const prisma = { conceptTerm: { findMany }, $queryRaw: queryRaw, $queryRawUnsafe: queryRaw };
    return { findMany, queryRaw, service: new ResolveService(prisma as never) };
  };

  it('has no threshold in force, because the calibration found none (FR-016, FR-018)', () => {
    expect(SIMILARITY_THRESHOLD).toBeNull();
    expect(CALIBRATION.separated).toBe(false);
    expect(CALIBRATION.matchingP5).toBeLessThan(CALIBRATION.nonMatchingP95);
  });

  it('names the baseline the calibration used, so no later reader mistakes it for real-world phrasing (FR-019b)', () => {
    expect(CALIBRATION.baseline).toEqual(expect.stringContaining('own source material'));
    expect(CALIBRATION.baseline).toEqual(expect.stringContaining('floor'));
    expect(CALIBRATION.record).toBe('docs/calibration/resolve-threshold.json');
  });

  it('returns unresolved for a phrase tier 1 missed, and never the nearest concept (FR-008)', async () => {
    const { service } = buildService();

    const [resolution] = await service.resolve(['event driven autoscaling']);

    expect(resolution.tier).toBe('unresolved');
    expect(resolution.conceptId).toBeNull();
  });

  it('consults no vector at all while there is no threshold to compare one against', async () => {
    // The concept vectors are only reachable through raw SQL -- Prisma cannot select a
    // `vector` column. A resolver that started scoring phrases would have to go through
    // here, so this is the assertion that catches a similarity tier smuggled in against
    // a hand-chosen number.
    const { queryRaw, service } = buildService();

    await service.resolve(['event driven autoscaling', 'sharding', 'circuit breaking']);

    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('records the tier on every outcome, resolved or not (FR-009)', async () => {
    const { service } = buildService();

    const resolutions = await service.resolve(['sharding', 'kubernetes']);

    for (const resolution of resolutions) {
      expect(['exact', 'similarity', 'unresolved']).toContain(resolution.tier);
      expect(resolution.tier).toBeDefined();
    }
  });

  it('leaves the score null rather than reporting a best score no measurement produced (FR-008)', async () => {
    // FR-008 wants an unresolved item to carry the best score seen. There is no best
    // score to carry: nothing was scored, because scoring requires a threshold to judge
    // the result against. Null is the honest value; a number here would be the invented
    // measurement FR-016 forbids.
    const { service } = buildService();

    const [resolution] = await service.resolve(['event driven autoscaling']);

    expect(resolution.score).toBeNull();
  });
});
