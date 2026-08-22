/**
 * Building the matching baseline's phrases out of a concept's own source material.
 *
 * Pure functions over chunk rows: no Prisma, no Nest, no I/O. FR-017's independence
 * requirement is the part of this feature easiest to satisfy in name only, so the rules
 * that make the sample non-circular live where a test can drive them directly.
 *
 * Two records must not leak into a phrase:
 *
 *  1. `concept_terms` -- the table tier 1 looks up. Handled by masking every recorded
 *     name of the concept out of the text.
 *  2. the **preamble chunk** -- less obvious and more dangerous. A concept's stored
 *     vector is name + terms + the opening 500 characters of its preamble
 *     (scripts/ingest-corpus.ts). Scoring a phrase taken from there against that vector
 *     would compare text with itself. Preambles are excluded outright.
 */

export interface SourceChunk {
  chunkId: string;
  headingPath: string[];
  content: string;
}

export interface PhraseSamplingInput {
  conceptId: string;
  /** Every recorded way of naming this concept, masked out of the phrases. */
  mask: string[];
  chunks: SourceChunk[];
}

/** Short enough to be a plausible query, long enough to carry meaning without the name. */
const MIN_PHRASE_CHARS = 60;
const MAX_PHRASE_CHARS = 300;

/** What a masked name is replaced with. Neutral, and keeps the sentence readable. */
const MASK_REPLACEMENT = 'this approach';

/**
 * Deterministic phrases from a concept's own material, masked and de-navigated.
 *
 * Order is by `chunkId` and then by position within the chunk, so the same rows produce
 * the same phrases in the same order however the caller happened to fetch them (FR-019).
 *
 * The chosen phrases are spread evenly across the whole eligible pool rather than taken
 * from its front. Taking the front is the obvious implementation and it is systematically
 * biased: sections sort by `chunkId`, so "Context and problem" comes first for nearly
 * every Azure pattern, and that section is written to state a *general* difficulty before
 * the pattern is introduced. A sample made only of those sentences measures how well
 * generic problem statements identify a concept, which is a different and much harder
 * question than the one FR-019a asks.
 */
export function samplePhrases(input: PhraseSamplingInput, perConcept: number): string[] {
  const pool = eligiblePhrases(input);
  if (pool.length <= perConcept) return pool;

  const chosen: string[] = [];
  for (let i = 0; i < perConcept; i++) {
    chosen.push(pool[Math.floor(((i + 0.5) * pool.length) / perConcept)]);
  }
  return chosen;
}

/** Every phrase a concept's material yields, in document order. */
export function eligiblePhrases(input: PhraseSamplingInput): string[] {
  const chunks = [...input.chunks].sort((a, b) => a.chunkId.localeCompare(b.chunkId));
  const phrases: string[] = [];

  for (const chunk of chunks) {
    // The preamble is what the concept vector was built from (see the file comment).
    if (chunk.headingPath.length <= 1) continue;
    const cleaned = stripCode(chunk.content);
    if (isMostlyLinks(cleaned)) continue;

    for (const sentence of splitSentences(unlink(cleaned))) {
      const masked = collapse(maskNames(sentence, input.mask));
      if (masked.length < MIN_PHRASE_CHARS || masked.length > MAX_PHRASE_CHARS) continue;
      if (phrases.includes(masked)) continue;
      phrases.push(masked);
    }
  }

  return phrases;
}

function stripCode(content: string): string {
  return content.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

/**
 * A section that is mostly links is a navigation list -- "Related resources", "Next
 * steps" -- whose text is about *other* concepts. Used as a matching phrase it is a
 * mislabelled positive. The rule is measured rather than a list of section titles, so a
 * link list under any heading is caught.
 */
function isMostlyLinks(content: string): boolean {
  const lines = content.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return true;
  const linked = lines.filter((line) => /\[[^\]]*\]\([^)]*\)/.test(line)).length;
  return linked * 2 >= lines.length;
}

/** `[text](url)` and `[text][ref]` become `text`; the target is not prose. */
function unlink(content: string): string {
  return content.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');
}

function splitSentences(content: string): string[] {
  return content
    .split('\n')
    // Headings, block quotes, table rows and list bullets are markup, not prose.
    .map((line) => line.replace(/^\s*([#>]+|[-*+]|\d+\.)\s*/, ''))
    .filter((line) => !line.trim().startsWith('|'))
    .join(' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim());
}

/**
 * Remove the concept's own names. Without this the baseline measures whether the string
 * "Circuit Breaker" embeds near the concept "Circuit Breaker", which is trivially true
 * and is the same circularity FR-017 names -- the name is exactly what `concept_terms`
 * holds and exactly what the concept vector leads with.
 *
 * It is also the right regime for the tier being calibrated: tier 2 only ever sees
 * phrases tier 1 did *not* match, so a phrase that spells the concept's name is not a
 * case tier 2 has to handle.
 */
function maskNames(sentence: string, mask: string[]): string {
  let masked = sentence;
  // Longest first, so "Queue-Based Load Leveling" is removed before "Load".
  for (const name of [...mask].sort((a, b) => b.length - a.length)) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    masked = masked.replace(new RegExp(escapeRegExp(trimmed), 'gi'), MASK_REPLACEMENT);
  }
  return masked;
}

function collapse(sentence: string): string {
  return sentence.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
