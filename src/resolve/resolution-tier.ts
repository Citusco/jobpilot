import type { ResolutionTier as StoredResolutionTier } from '../generated/prisma/enums.js';

/**
 * The tiers the API reports, and how the fourth one survives into a three-valued column.
 *
 * `containment` is a different claim from `exact` -- one says the posting used a
 * registered name, the other says the posting used a phrase with one inside it -- and a
 * wrong resolution has to be traceable to the pass that produced it. The obvious way to
 * record that is a fourth `ResolutionTier` value, which is a Postgres enum change and
 * therefore a database schema change; Principle III routes those through the full
 * planning flow, which is disproportionate for a matching rule.
 *
 * So the distinction rides in the row without a new column. `normalized` is a registered
 * term if and only if exact equality produced the match: a phrase equal to a term is
 * answered by the exact lookup and never reaches the containment pass, and the
 * containment pass explicitly declines a phrase equal to the term it matched. The stored
 * row plus `concept_terms` therefore determines the pass, with no residue -- the same
 * derive-rather-than-materialise choice the concept graph already makes for its edges
 * (specs/007-jd-concept-graph/data-model.md, "Derived, not stored").
 *
 * The cost is written down in docs/DECISIONS.md: admitting a new alias later can
 * retroactively relabel an old containment row as exact. That is a human corpus-admission
 * act, rare, and it only ever moves a row toward the stronger claim.
 */
export type ApiResolutionTier = 'exact' | 'containment' | 'similarity' | 'unresolved';

export function storedTierFor(tier: ApiResolutionTier): StoredResolutionTier {
  return tier === 'containment' ? 'exact' : tier;
}

export interface StoredResolutionRow {
  tier: StoredResolutionTier;
  normalized: string;
}

/**
 * Read a stored row's tier back, distinguishing the two matching passes.
 *
 * `registeredTerms` is every `concept_terms.term`. An empty set means the caller could
 * not load it, and the honest answer then is the tier the row literally stores -- not to
 * relabel every exact match in the database as containment.
 */
export function apiTierForRow(
  row: StoredResolutionRow,
  registeredTerms: ReadonlySet<string>,
): ApiResolutionTier {
  if (row.tier !== 'exact') return row.tier;
  if (registeredTerms.size === 0) return 'exact';
  return registeredTerms.has(row.normalized) ? 'exact' : 'containment';
}
