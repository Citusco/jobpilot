import { normalizeTerm } from '../../../src/corpus/normalize-term.js';

// FR-014: normalizeTerm is the single implementation shared by every writer
// and reader of concept_terms; a second implementation that drifts would
// produce lookups that silently return nothing (docs/DECISIONS.md 2026-08-10).
describe('normalizeTerm', () => {
  it('lowercases', () => {
    expect(normalizeTerm('CQRS')).toBe('cqrs');
    expect(normalizeTerm('Throttling')).toBe('throttling');
  });

  it('removes all non-alphanumeric characters, not just collapses them', () => {
    expect(normalizeTerm('Circuit Breaker')).toBe('circuitbreaker');
    expect(normalizeTerm('Queue-Based Load Leveling')).toBe('queuebasedloadleveling');
  });

  it('unifies concatenated and separated spellings of the same phrase', () => {
    // The measured reason for stripping rather than collapsing
    // (docs/DECISIONS.md 2026-08-10, "Terms are extracted mechanically"):
    // both variants must land on the same normalized term.
    expect(normalizeTerm('anti-corruption-layer')).toBe(normalizeTerm('anticorruption layer'));
    expect(normalizeTerm('anti-corruption-layer')).toBe('anticorruptionlayer');
  });

  it('leaves genuinely distinct concepts distinct', () => {
    expect(normalizeTerm('throttling')).not.toBe(normalizeTerm('rate-limiting'));
    expect(normalizeTerm('cqrs')).not.toBe(normalizeTerm('event-sourcing'));
  });

  it('is idempotent', () => {
    const once = normalizeTerm('Queue-Based Load Leveling');
    expect(normalizeTerm(once)).toBe(once);
  });
});
