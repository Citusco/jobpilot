import {
  apiTierForRow,
  storedTierFor,
} from '../../../src/resolve/resolution-tier.js';

/**
 * How a containment hit survives into the stored row without a migration.
 *
 * `ResolutionTier` in Postgres has three values and adding a fourth is a schema change,
 * which Principle III routes through the full planning flow -- disproportionate for an
 * afternoon's matching rule. The distinction is instead carried by the row itself:
 * `normalized` is a registered term if and only if exact equality produced the match,
 * because a phrase equal to a term never reaches the containment pass at all. These are
 * the tests that make that an asserted invariant rather than an observation.
 */

const REGISTERED = new Set(['retry', 'throttling', 'ratelimiting']);

describe('storedTierFor', () => {
  it('writes a containment hit into the row as `exact`', () => {
    expect(storedTierFor('containment')).toBe('exact');
  });

  it('passes the three real enum values through unchanged', () => {
    expect(storedTierFor('exact')).toBe('exact');
    expect(storedTierFor('similarity')).toBe('similarity');
    expect(storedTierFor('unresolved')).toBe('unresolved');
  });
});

describe('apiTierForRow', () => {
  it('reads a row whose normalized phrase is a registered term back as exact', () => {
    expect(
      apiTierForRow({ tier: 'exact', normalized: 'throttling' }, REGISTERED),
    ).toBe('exact');
  });

  it('reads a row whose normalized phrase is not a registered term back as containment', () => {
    expect(
      apiTierForRow({ tier: 'exact', normalized: 'retrypatterns' }, REGISTERED),
    ).toBe('containment');
  });

  it('round-trips every tier through storage', () => {
    const rows = [
      { tier: 'exact' as const, normalized: 'retry' },
      { tier: 'exact' as const, normalized: 'microservicesestate' },
      { tier: 'unresolved' as const, normalized: 'kubernetes' },
    ];
    expect(rows.map((row) => apiTierForRow(row, REGISTERED))).toEqual([
      'exact',
      'containment',
      'unresolved',
    ]);
  });

  it('does not reinterpret an unresolved row, whatever its phrase looks like', () => {
    // An unresolved row has no concept, so there is no match to attribute to a pass.
    expect(
      apiTierForRow({ tier: 'unresolved', normalized: 'retrypatterns' }, REGISTERED),
    ).toBe('unresolved');
  });

  it('treats an empty term set as "cannot tell", and says exact rather than inventing containment', () => {
    // The derivation needs the term index. Reading a row without it must not silently
    // relabel every exact match as a containment one -- the honest failure is to report
    // the tier the row literally stores.
    expect(apiTierForRow({ tier: 'exact', normalized: 'retry' }, new Set())).toBe('exact');
  });
});
