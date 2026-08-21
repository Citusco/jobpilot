import { Injectable } from '@nestjs/common';

import { normalizeTerm } from '../corpus/normalize-term.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type ResolutionTier = 'exact' | 'similarity' | 'unresolved';

/**
 * One phrase and what the corpus says it refers to.
 *
 * Exactly three outcomes exist and there is no fourth. `conceptId` is null if and only if
 * `tier` is `unresolved`; the state is carried by `tier`, never inferred from the null
 * (data-model.md). `score` is null for `exact` -- there is no score, and writing 1.0
 * would record a measurement that never happened.
 */
export interface Resolution {
  surface: string;
  normalized: string;
  conceptId: string | null;
  tier: ResolutionTier;
  score: number | null;
}

/**
 * Tier 1: an exact match of the normalised phrase against `concept_terms`.
 *
 * `concept_terms.term` is the primary key, so this is one indexed lookup that yields at
 * most one concept per phrase -- deterministic, and by FR-006 it must not consult any
 * similarity measure. That is why this class takes Prisma and nothing else: it has no
 * embedding client to call and no threshold to apply.
 *
 * Everything the exact tier does not match is `unresolved` in this feature's first
 * increment. The similarity tier arrives with the calibration that gives it a threshold
 * (US3); adding it now against a placeholder number is exactly what FR-016 forbids.
 *
 * Tier 1 can be confidently wrong and that is accepted by design: "rate limiting" names
 * `rate-limiting` exactly while colloquially usually meaning `throttling`
 * (docs/DECISIONS.md, 2026-08-10). The graph is what surfaces the neighbour; overriding
 * an exact match here would remove the one place in resolve that cannot be wrong.
 */
@Injectable()
export class ResolveService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(surfaces: string[]): Promise<Resolution[]> {
    if (surfaces.length === 0) return [];

    const normalized = surfaces.map((surface) => normalizeTerm(surface));
    const rows = await this.prisma.conceptTerm.findMany({
      where: { term: { in: normalized } },
      select: { term: true, conceptId: true },
    });
    const byTerm = new Map(rows.map((row) => [row.term, row.conceptId]));

    return surfaces.map((surface, index) => {
      const term = normalized[index];
      const conceptId = byTerm.get(term);
      if (conceptId === undefined) {
        // No nearest-concept fallback (FR-008). An honest unresolved is the answer.
        return { surface, normalized: term, conceptId: null, tier: 'unresolved', score: null };
      }
      return { surface, normalized: term, conceptId, tier: 'exact', score: null };
    });
  }
}
