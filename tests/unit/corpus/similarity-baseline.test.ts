import { cosineSimilarity, percentile } from '../../../scripts/ingest-corpus.js';

// FR-022: the similarity-baseline evidence a later threshold will be
// calibrated against. Pure functions, tested directly rather than round
// tripped through ingestConceptVectors -- that function operates on the
// whole concepts table with no scoping, so exercising it with a fake
// client in a test would overwrite every real concept's embedding in the
// shared dev database. Its correctness is instead verified by the real,
// live run recorded in quickstart.md / this feature's completion report.
describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    const v = [0.5, 0.3, -0.2, 0.8];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 10);
  });

  it('is symmetric', () => {
    const a = [0.1, 0.9, -0.3];
    const b = [0.4, -0.2, 0.7];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});

describe('percentile', () => {
  it('returns the value at the given percentile of an ascending-sorted array', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 90)).toBe(10);
  });

  it('returns NaN for an empty array rather than throwing', () => {
    expect(percentile([], 50)).toBeNaN();
  });

  it('never indexes past the end of the array', () => {
    expect(percentile([1, 2, 3], 100)).toBe(3);
  });
});
