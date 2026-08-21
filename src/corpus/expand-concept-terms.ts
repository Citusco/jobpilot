import { normalizeTerm } from './normalize-term.js';

// Shared by scripts/ingest-corpus.ts (writer) and
// tests/unit/corpus/concept-terms.test.ts (the no-database uniqueness
// check) -- one implementation of "which phrases identify this concept",
// per specs/006-corpus-structure-rebuild/data-model.md's ConceptTerm
// population table.

export type TermType = 'id' | 'name' | 'title' | 'alias';

export interface ConceptTermSource {
  conceptId: string;
  name: string;
  title: string | null; // raw H1/frontmatter title, unstripped of "Pattern"
}

export interface ExpandedTerm {
  term: string; // normalized
  displayTerm: string; // as authored
  termType: TermType;
}

const PRECEDENCE: Record<TermType, number> = { id: 0, name: 1, title: 2, alias: 3 };

const TRAILING_PATTERN_RE = /\s+pattern$/i;

/**
 * Expands one concept's identifying strings into normalized terms,
 * deduplicating WITHIN this concept (highest precedence wins: id > name >
 * title > alias -- docs/DECISIONS.md 2026-08-10). Cross-concept collision
 * is not this function's concern: the caller (ingest, or the uniqueness
 * test) checks that across the whole concept set.
 */
export function expandConceptTerms(source: ConceptTermSource): ExpandedTerm[] {
  const candidates: Array<{ displayTerm: string; termType: TermType }> = [
    { displayTerm: source.conceptId, termType: 'id' },
    { displayTerm: source.name, termType: 'name' },
  ];

  if (source.title) {
    candidates.push({ displayTerm: source.title, termType: 'title' });
  }

  const withPattern = TRAILING_PATTERN_RE.test(source.name) ? source.name : `${source.name} pattern`;
  const withoutPattern = source.name.replace(TRAILING_PATTERN_RE, '');
  candidates.push({ displayTerm: withPattern, termType: 'title' });
  if (withoutPattern !== source.name) {
    candidates.push({ displayTerm: withoutPattern, termType: 'title' });
  }

  const byTerm = new Map<string, ExpandedTerm>();
  for (const candidate of candidates) {
    const term = normalizeTerm(candidate.displayTerm);
    if (!term) continue;
    const existing = byTerm.get(term);
    if (!existing || PRECEDENCE[candidate.termType] < PRECEDENCE[existing.termType]) {
      byTerm.set(term, { term, displayTerm: candidate.displayTerm, termType: candidate.termType });
    }
  }
  return [...byTerm.values()];
}
