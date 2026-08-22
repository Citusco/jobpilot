/**
 * Deriving the similarity threshold tier 2 runs against, from two measured
 * distributions.
 *
 * The relation measured here is **a phrase against a concept**, because that is the
 * relation resolution performs. SCRUM-44 measured concept-against-concept similarity
 * over `related` edges and used it as a positive baseline; those are pairs resolution
 * must keep apart, so a high score there is evidence of a problem, not of health
 * (docs/DECISIONS.md, 2026-08-11 "Correction: the measured baselines do not calibrate
 * resolve's threshold"). Nothing in this module can produce that mistake again: a
 * matching score is only ever a phrase scored against the concept whose material the
 * phrase came from.
 *
 * Pure functions: vectors in, numbers out. No Prisma, no embedding client, no I/O --
 * scripts/calibrate-threshold.ts supplies those.
 */

export interface PhraseSample {
  /** The concept whose own source material this phrase came from. */
  conceptId: string;
  phrase: string;
  vector: number[];
}

export interface ConceptVector {
  conceptId: string;
  /** false marks a concept the corpus knows of but holds no material for. */
  hasCorpus: boolean;
  vector: number[];
}

export interface Distribution {
  n: number;
  min: number;
  p5: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface ScoredPhrase {
  conceptId: string;
  phrase: string;
  /** Cosine against the concept the phrase came from. */
  ownScore: number;
  /** The strongest concept *with material* that is not the phrase's own. */
  bestOtherConceptId: string | null;
  bestOtherScore: number;
  /** The strongest concept *without material*, reported apart from the rest (FR-010). */
  bestGreyConceptId: string | null;
  bestGreyScore: number;
}

export interface CalibrationResult {
  /** FR-019b: which baseline produced this, recorded so it cannot be misread later. */
  baseline: string;
  /** FR-019b: this establishes a floor, never a verdict about real-world phrasing. */
  isFloor: true;
  materialConcepts: number;
  greyConcepts: number;
  /** Phrase against its own concept. */
  matching: Distribution;
  /** Phrase against the strongest *different* concept with material (FR-019a). */
  nonMatching: Distribution;
  /** Phrase against the strongest concept with no material, kept out of the threshold. */
  nonMatchingGrey: Distribution;
  /**
   * Null in every realistic run: a concept with no material has no own words, so its
   * matching baseline is not constructible. Recorded explicitly rather than left to be
   * inferred from a zero.
   */
  greyMatching: Distribution | null;
  /** p5 of matching minus p95 of non-matching. Negative means the two overlap. */
  separation: number;
  separated: boolean;
  /** Null unless the distributions separate (FR-018). */
  threshold: number | null;
  /** A plain statement of the overlap when there is one, otherwise null. */
  overlap: string | null;
  scored: ScoredPhrase[];
}

/**
 * FR-019a and FR-019b in one string, written into every record this produces.
 */
export const MATCHING_BASELINE =
  'phrases drawn from each concept\'s own source material (non-preamble chunks, concept names masked), ' +
  'scored against the stored concept vectors; the non-matching baseline is the same phrases scored ' +
  'against a different concept. Independent of concept_terms, which tier 1 matches against. ' +
  'This is a floor: a concept that cannot be recognised from its own words will not be rescued by ' +
  'alternative phrasing, while success here says nothing about whether real job-description wording ' +
  'reaches the right concept.';

export function calibrate(
  samples: PhraseSample[],
  concepts: ConceptVector[],
): CalibrationResult {
  const material = concepts.filter((c) => c.hasCorpus);
  const grey = concepts.filter((c) => !c.hasCorpus);
  const byId = new Map(concepts.map((c) => [c.conceptId, c]));
  const greyIds = new Set(grey.map((c) => c.conceptId));

  const scored: ScoredPhrase[] = [];
  for (const sample of samples) {
    const own = byId.get(sample.conceptId);
    if (!own) continue; // a phrase for a concept that is not in the set scores nothing
    const other = best(sample.vector, material, sample.conceptId);
    const nearestGrey = best(sample.vector, grey, sample.conceptId);
    scored.push({
      conceptId: sample.conceptId,
      phrase: sample.phrase,
      ownScore: cosineSimilarity(sample.vector, own.vector),
      bestOtherConceptId: other.conceptId,
      bestOtherScore: other.score,
      bestGreyConceptId: nearestGrey.conceptId,
      bestGreyScore: nearestGrey.score,
    });
  }

  const fromMaterial = scored.filter((row) => !greyIds.has(row.conceptId));
  const fromGrey = scored.filter((row) => greyIds.has(row.conceptId));

  const matching = distribution(fromMaterial.map((row) => row.ownScore));
  const nonMatching = distribution(
    fromMaterial.filter((row) => row.bestOtherConceptId !== null).map((row) => row.bestOtherScore),
  );
  const nonMatchingGrey = distribution(
    fromMaterial.filter((row) => row.bestGreyConceptId !== null).map((row) => row.bestGreyScore),
  );

  const separation = matching.p5 - nonMatching.p95;
  // No sample is not a separation of zero. Reporting one would be the same failure
  // FR-018 exists for, in a different disguise.
  const measurable = matching.n > 0 && nonMatching.n > 0;
  const separated = measurable && separation > 0;

  return {
    baseline: MATCHING_BASELINE,
    isFloor: true,
    materialConcepts: material.length,
    greyConcepts: grey.length,
    matching,
    nonMatching,
    nonMatchingGrey,
    greyMatching: fromGrey.length === 0 ? null : distribution(fromGrey.map((r) => r.ownScore)),
    separation: measurable ? separation : Number.NaN,
    separated,
    // The midpoint of the gap. Derived from the two distributions and from nothing else
    // -- there is no hand-supplied number anywhere in this module (FR-016).
    threshold: separated ? (matching.p5 + nonMatching.p95) / 2 : null,
    overlap: separated
      ? null
      : measurable
        ? `the distributions overlap: the matching baseline's p5 (${matching.p5.toFixed(4)}) is at or ` +
          `below the non-matching baseline's p95 (${nonMatching.p95.toFixed(4)}), so no threshold ` +
          'separates them and none is emitted'
        : 'no samples to measure, so no separation exists to report and no threshold is emitted',
    scored,
  };
}

function best(
  vector: number[],
  candidates: ConceptVector[],
  exclude: string,
): { conceptId: string | null; score: number } {
  let bestId: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  // Ordered by concept id so a tie breaks the same way on every run (FR-019).
  for (const candidate of [...candidates].sort((a, b) => a.conceptId.localeCompare(b.conceptId))) {
    if (candidate.conceptId === exclude) continue;
    const score = cosineSimilarity(vector, candidate.vector);
    if (score > bestScore) {
      bestScore = score;
      bestId = candidate.conceptId;
    }
  }
  return { conceptId: bestId, score: bestId === null ? Number.NaN : bestScore };
}

export function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { n: 0, min: Number.NaN, p5: Number.NaN, p50: Number.NaN, p95: Number.NaN, max: Number.NaN, mean: Number.NaN };
  }
  return {
    n: sorted.length,
    min: sorted[0],
    p5: percentile(sorted, 5),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

export function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return Number.NaN;
  const idx = Math.min(sortedAscending.length - 1, Math.floor((p / 100) * sortedAscending.length));
  return sortedAscending[idx];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dot / magnitude;
}
