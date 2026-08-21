// The single implementation of concept-term normalization, imported by both
// ingest (writer) and the future resolve (reader). Two implementations that
// drift would produce lookups that silently return nothing -- see
// docs/DECISIONS.md's 2026-08-10 "Terms are extracted mechanically" entry,
// which also records why this strips rather than collapses non-alphanumeric
// characters: it unifies concatenated and separated spellings of the same
// phrase (`anti-corruption-layer` / `anticorruption layer`) at no cost,
// since `displayTerm` carries the readable form separately.
export function normalizeTerm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
