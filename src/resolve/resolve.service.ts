import { Injectable } from '@nestjs/common';

import { NON_CONCEPT_IDS } from '../corpus/non-concept-ids.js';
import { normalizeTerm } from '../corpus/normalize-term.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildContainmentIndex, matchByContainment } from './containment-match.js';
import type { ApiResolutionTier } from './resolution-tier.js';

export type ResolutionTier = ApiResolutionTier;

/**
 * One phrase and what the corpus says it refers to.
 *
 * Four outcomes exist and there is no fifth. `conceptId` is null if and only if `tier` is
 * `unresolved`; the state is carried by `tier`, never inferred from the null
 * (data-model.md). `score` is null for `exact` and for `containment` -- neither is a
 * measurement, and writing 1.0 would record one that never happened.
 */
export interface Resolution {
  surface: string;
  normalized: string;
  conceptId: string | null;
  tier: ResolutionTier;
  score: number | null;
}

/**
 * Tier 1, in two passes over `concept_terms` and nothing else.
 *
 * Pass one is exact equality of the normalised phrase against the term primary key: one
 * indexed lookup, at most one concept per phrase. Pass two, for the phrases pass one
 * missed, asks whether the phrase *contains* a registered term at word boundaries --
 * `retry patterns` contains `retry`, `microservices estate` contains `microservices`. It
 * is deterministic and offline for the same reason pass one is, which is why this class
 * still takes Prisma and nothing else: no embedding client, no threshold.
 *
 * Neither pass is the similarity tier. The calibration that would give one a threshold
 * ran and found no separation, and FR-016 forbids a number without a measurement behind
 * it; the containment pass needs no number, which is precisely why it is admissible here
 * and a nearest-vector fallback is not (FR-008).
 *
 * Tier 1 can be confidently wrong and that is accepted by design: "rate limiting" names
 * `rate-limiting` exactly while colloquially usually meaning `throttling`
 * (docs/DECISIONS.md, 2026-08-10). The graph is what surfaces the neighbour. The
 * containment pass raises that stake -- it resolves phrases nothing downstream can
 * overrule -- so it declines wherever the answer is arguable; see
 * `matchByContainment`.
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

    const misses = surfaces.filter((_, index) => !byTerm.has(normalized[index]));
    // The whole term index, but only when there is something left to match against it.
    // A posting whose every phrase resolved exactly pays for one query, as before.
    const index =
      misses.length === 0
        ? null
        : buildContainmentIndex(
            await this.prisma.conceptTerm.findMany({
              select: { displayTerm: true, conceptId: true },
            }),
            NON_CONCEPT_IDS,
          );

    return surfaces.map((surface, position) => {
      const term = normalized[position];
      const conceptId = byTerm.get(term);
      if (conceptId !== undefined) {
        return { surface, normalized: term, conceptId, tier: 'exact', score: null };
      }
      const contained = index === null ? null : matchByContainment(surface, index);
      if (contained !== null) {
        return {
          surface,
          normalized: term,
          conceptId: contained.conceptId,
          tier: 'containment',
          score: null,
        };
      }
      // No nearest-concept fallback (FR-008). An honest unresolved is the answer.
      return { surface, normalized: term, conceptId: null, tier: 'unresolved', score: null };
    });
  }
}
