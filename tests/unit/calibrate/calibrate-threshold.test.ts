import {
  calibrate,
  MATCHING_BASELINE,
  type ConceptVector,
  type PhraseSample,
} from '../../../src/calibrate/calibrate-threshold.js';

/**
 * The threshold tier 2 runs against, and the evidence it rests on.
 *
 * SCRUM-44 produced a calibration that was honestly labelled and measured the wrong
 * relation: similarity between two *different* concepts joined by a `related` edge, used
 * as a positive baseline. Those are concepts resolution must keep apart, so a high score
 * there is evidence of a problem (docs/DECISIONS.md, 2026-08-11 correction). What
 * resolution actually performs is **a phrase against a concept**, and that is the only
 * relation these assertions allow to set a number.
 */

/** A unit vector at `deg` in the first two dimensions, so cosine is cos(a - b). */
function vec(deg: number): number[] {
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

const material = (conceptId: string, deg: number): ConceptVector => ({
  conceptId,
  hasCorpus: true,
  vector: vec(deg),
});
const grey = (conceptId: string, deg: number): ConceptVector => ({
  conceptId,
  hasCorpus: false,
  vector: vec(deg),
});
const phrase = (conceptId: string, text: string, deg: number): PhraseSample => ({
  conceptId,
  phrase: text,
  vector: vec(deg),
});

describe('calibrate', () => {
  // Three concepts far apart, each with phrases that sit close to their own concept.
  const separable = {
    concepts: [material('a', 0), material('b', 90), material('c', 180)],
    samples: [
      phrase('a', 'phrase about a', 8),
      phrase('a', 'another phrase about a', 12),
      phrase('b', 'phrase about b', 82),
      phrase('b', 'another phrase about b', 96),
      phrase('c', 'phrase about c', 173),
      phrase('c', 'another phrase about c', 187),
    ],
  };

  it('reports both distributions and the separation between them (FR-016, FR-018)', () => {
    const result = calibrate(separable.samples, separable.concepts);

    expect(result.matching.n).toBe(6);
    expect(result.nonMatching.n).toBe(6);
    expect(result.matching.p5).toBeGreaterThan(result.nonMatching.p95);
    expect(result.separation).toBeCloseTo(result.matching.p5 - result.nonMatching.p95, 10);
    expect(result.separated).toBe(true);
  });

  it('scores each phrase against its own concept and against a different one, never against itself as a negative (FR-019a)', () => {
    const result = calibrate(separable.samples, separable.concepts);

    for (const row of result.scored) {
      expect(row.bestOtherConceptId).not.toBe(row.conceptId);
      expect(row.bestOtherConceptId).not.toBeNull();
      expect(row.ownScore).toBeGreaterThan(row.bestOtherScore);
    }
  });

  it('derives the threshold from the two distributions rather than taking one (FR-016)', () => {
    const result = calibrate(separable.samples, separable.concepts);

    expect(result.threshold).not.toBeNull();
    expect(result.threshold!).toBeGreaterThan(result.nonMatching.p95);
    expect(result.threshold!).toBeLessThan(result.matching.p5);
  });

  it('reports overlap and emits no number when no threshold separates the distributions (FR-018)', () => {
    // Phrases sitting nearer a different concept than their own: no cut can split these.
    const overlapping = calibrate(
      [
        phrase('a', 'phrase about a', 70),
        phrase('a', 'another phrase about a', 5),
        phrase('b', 'phrase about b', 20),
        phrase('b', 'another phrase about b', 85),
      ],
      [material('a', 0), material('b', 90)],
    );

    expect(overlapping.separated).toBe(false);
    expect(overlapping.threshold).toBeNull();
    expect(overlapping.overlap).toEqual(expect.stringContaining('overlap'));
    // The distributions themselves are still reported -- refusing a number is not
    // refusing the measurement.
    expect(overlapping.matching.n).toBe(4);
    expect(overlapping.nonMatching.n).toBe(4);
  });

  it('keeps concepts with no material out of the threshold and reports them separately (FR-010)', () => {
    // A grey vector deliberately placed nearer every phrase than any material concept.
    // Its representation is built from a name alone (docs/DECISIONS.md, 2026-08-22), so
    // it must not be allowed to set, or to spoil, the threshold for concepts with
    // material.
    const withGrey = calibrate(separable.samples, [...separable.concepts, grey('g', 10)]);
    const withoutGrey = calibrate(separable.samples, separable.concepts);

    expect(withGrey.threshold).toBe(withoutGrey.threshold);
    expect(withGrey.separated).toBe(true);
    expect(withGrey.nonMatching).toEqual(withoutGrey.nonMatching);

    expect(withGrey.nonMatchingGrey.n).toBe(6);
    expect(withGrey.nonMatchingGrey.p95).toBeGreaterThan(withGrey.nonMatching.p95);
    for (const row of withGrey.scored) {
      expect(row.bestGreyConceptId).toBe('g');
    }
  });

  it('records no grey matching baseline, because a concept with no material has no own words', () => {
    const result = calibrate(separable.samples, [...separable.concepts, grey('g', 10)]);

    expect(result.greyMatching).toBeNull();
    expect(result.greyConcepts).toBe(1);
  });

  it('names the baseline that produced the threshold and says it is a floor (FR-019b)', () => {
    const result = calibrate(separable.samples, separable.concepts);

    expect(result.baseline).toBe(MATCHING_BASELINE);
    expect(result.baseline).toEqual(expect.stringContaining('own source material'));
    expect(result.isFloor).toBe(true);
  });

  it('is repeatable on unchanged input (FR-019)', () => {
    const first = calibrate(separable.samples, separable.concepts);
    const second = calibrate(separable.samples, separable.concepts);

    expect(second).toEqual(first);
  });

  it('refuses to calibrate from no samples rather than reporting an empty separation', () => {
    const empty = calibrate([], separable.concepts);

    expect(empty.separated).toBe(false);
    expect(empty.threshold).toBeNull();
    expect(empty.matching.n).toBe(0);
  });
});
