/**
 * Tier 1's second pass: a registered concept term contained inside the posting's phrase.
 *
 * Exact equality answers `Throttling` and misses `retry patterns`, `event-driven flows`
 * and `microservices estate` -- 8 of one real posting's 29 unresolved items literally
 * carry a concept name inside them. This finds those, deterministically: no vector, no
 * threshold, no provider call, and therefore nothing that could return a different answer
 * tomorrow. It is emphatically not the similarity tier; the calibration that would give
 * one a threshold found no separation and that still stands (docs/DECISIONS.md).
 *
 * Everything here is pure. The resolver supplies the terms.
 */

/** One row of `concept_terms`, reduced to what containment needs. */
export interface RegisteredTerm {
  displayTerm: string;
  conceptId: string;
}

export interface ContainmentMatch {
  conceptId: string;
  /** The registered phrase that matched, in its loose form, for tracing a wrong hit. */
  matchedTerm: string;
}

interface IndexEntry {
  conceptId: string;
  phrase: string;
  words: string[];
}

export interface ContainmentIndex {
  entries: IndexEntry[];
}

/**
 * The shortest term the pass will consider, in alphanumeric characters.
 *
 * `cqrs` and `saga` are the shortest real terms in the corpus at four, so today this
 * excludes nothing. It is here for what comes next: a two- or three-character alias --
 * `api`, `cdn`, `k8s` -- is a fragment, and a fragment inside a longer phrase says
 * almost nothing about what the phrase means.
 */
export const MIN_CONTAINMENT_TERM_CHARS = 4;

/**
 * Lowercase, with every run of non-alphanumeric characters collapsed to one space.
 *
 * Deliberately different from `normalizeTerm`, which strips those characters outright.
 * Stripping is right for exact lookup -- it unifies `anti-corruption-layer` and
 * `anticorruption layer` -- and wrong for containment, because on the stripped form `api`
 * sits inside `rapid` and `index` inside `indexing`. Keeping the boundaries is the whole
 * reason a containment match can be trusted at all.
 */
export function loosePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function alphanumericLength(phrase: string): number {
  return phrase.replace(/[^a-z0-9]/g, '').length;
}

/**
 * Prepare the term index once, so resolving twenty phrases does not re-split 147 terms
 * twenty times.
 *
 * `excludedConceptIds` is how the corpus's navigation pages stay out. They are registered
 * terms like any other, and `patterns` (8 characters) is longer than `retry` (5) -- so
 * without the exclusion the longest-match rule would hand `retry patterns` to an Azure
 * table of contents. The same set already guards the graph (src/corpus/non-concept-ids).
 */
export function buildContainmentIndex(
  terms: readonly RegisteredTerm[],
  excludedConceptIds: ReadonlySet<string> = new Set(),
): ContainmentIndex {
  const entries: IndexEntry[] = [];
  for (const term of terms) {
    if (excludedConceptIds.has(term.conceptId)) continue;
    const phrase = loosePhrase(term.displayTerm);
    if (alphanumericLength(phrase) < MIN_CONTAINMENT_TERM_CHARS) continue;
    entries.push({ conceptId: term.conceptId, phrase, words: phrase.split(' ') });
  }
  return { entries };
}

interface Span {
  start: number;
  end: number;
}

function occurrences(haystack: string[], needle: string[]): Span[] {
  if (needle.length === 0 || needle.length > haystack.length) return [];
  const found: Span[] = [];
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) found.push({ start: i, end: i + needle.length });
  }
  return found;
}

/**
 * The one concept a phrase contains, or null.
 *
 * Null is the answer wherever the right one is arguable, and that is the point. A
 * containment hit is written into `extracted_items` and read as fact by everything after
 * it -- there is no downstream step that can overrule it -- so the pass is built to
 * decline rather than to guess:
 *
 * - A phrase that *equals* a term is not reported. Exact equality owns that case and
 *   already ran; a match here would make the two passes indistinguishable in the row.
 * - Where several terms match, the longest wins **only if** every other match nests
 *   inside it. Nesting means the matches describe the same region of the phrase at
 *   different granularity, and the most specific reading is the better claim.
 * - Where two matches sit in different places -- `sidecar and bulkhead`, `throttling and
 *   rate limiting` -- the phrase is naming two things, and choosing one of them would be
 *   a coin toss recorded as a resolution. Unresolved.
 */
export function matchByContainment(
  surface: string,
  index: ContainmentIndex,
): ContainmentMatch | null {
  const phrase = loosePhrase(surface);
  if (phrase === '') return null;
  const words = phrase.split(' ');

  // Longest match per concept: one concept can register several terms (`retry` and
  // `retry pattern`), and two of its own terms overlapping is not an ambiguity.
  const best = new Map<string, { phrase: string; spans: Span[] }>();
  for (const entry of index.entries) {
    const spans = occurrences(words, entry.words);
    if (spans.length === 0) continue;
    const existing = best.get(entry.conceptId);
    if (existing === undefined || entry.phrase.length > existing.phrase.length) {
      best.set(entry.conceptId, { phrase: entry.phrase, spans });
    }
  }
  if (best.size === 0) return null;

  const ranked = [...best.entries()].sort((a, b) => b[1].phrase.length - a[1].phrase.length);
  const [winnerId, winner] = ranked[0];

  if (winner.phrase === phrase) return null;

  for (const [conceptId, other] of ranked.slice(1)) {
    if (conceptId === winnerId) continue;
    if (other.phrase.length === winner.phrase.length) return null;
    const nested = other.spans.some((span) =>
      winner.spans.some((host) => span.start >= host.start && span.end <= host.end),
    );
    if (!nested) return null;
  }

  return { conceptId: winnerId, matchedTerm: winner.phrase };
}
