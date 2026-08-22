import { Injectable } from '@nestjs/common';

import { AgentOrchestrationClient } from '../agent-orchestration/agent-orchestration.client.js';
import type { ExtractedItem } from '../agent-orchestration/schemas/extract-response.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeTerm } from '../corpus/normalize-term.js';
import { storedTierFor } from '../resolve/resolution-tier.js';
import { ResolveService, type ResolutionTier } from '../resolve/resolve.service.js';

export interface SubmittedItem {
  surface: string;
  conceptId: string | null;
  tier: ResolutionTier;
  score: number | null;
  evidence: string[];
}

export interface JdSubmissionSummary {
  total: number;
  exact: number;
  /** Tier 1's second pass: the phrase contains a registered term rather than being one. */
  containment: number;
  similarity: number;
  unresolved: number;
}

export interface JdSubmissionResult {
  submissionId: string;
  items: SubmittedItem[];
  summary: JdSubmissionSummary;
}

@Injectable()
export class JdSubmissionsService {
  constructor(
    private readonly agentClient: AgentOrchestrationClient,
    private readonly resolveService: ResolveService,
    private readonly prisma: PrismaService,
  ) {}

  async submit(text: string): Promise<JdSubmissionResult> {
    // Extraction failure propagates and fails the request. A submission stored with an
    // empty item list on error would be indistinguishable from a posting that genuinely
    // had no technical content (contracts/http-api.md).
    const { items } = await this.agentClient.extract(text);

    const merged = mergeByNormalizedPhrase(items);
    const resolutions = await this.resolveService.resolve(merged.map((item) => item.surface));

    const rows = resolutions.map((resolution, index) => ({
      surface: resolution.surface,
      normalized: resolution.normalized,
      evidence: merged[index].evidence,
      conceptId: resolution.conceptId,
      // `containment` is stored as `exact` and read back apart from it by comparing
      // `normalized` against the term index -- see src/resolve/resolution-tier.ts for
      // why the column does not grow a fourth value.
      tier: storedTierFor(resolution.tier),
      score: resolution.score,
    }));

    const submission = await this.prisma.jdSubmission.create({
      data: { rawText: text, items: { create: rows } },
    });

    const responseItems: SubmittedItem[] = rows.map((row, index) => ({
      surface: row.surface,
      conceptId: row.conceptId,
      tier: resolutions[index].tier,
      score: row.score,
      evidence: row.evidence,
    }));

    return {
      submissionId: submission.id,
      items: responseItems,
      summary: summarize(responseItems),
    };
  }
}

/**
 * FR-003: repeated mentions of the same phrase are one item retaining every occurrence
 * as evidence.
 *
 * Merging happens here rather than being left to the database because
 * `@@unique([submissionId, normalized])` would reject the second row outright, losing the
 * evidence with it. The constraint is the backstop, not the mechanism.
 *
 * Identity is the normalised phrase, so "Kubernetes" and "kubernetes" are one item -- the
 * same equivalence tier 1 resolves by. The first surface form seen wins, since one of the
 * two spellings has to be the one displayed and the posting's first use is as good a
 * choice as any. Duplicate evidence spans are dropped; distinct ones accumulate in the
 * order they were reported.
 */
function mergeByNormalizedPhrase(items: ExtractedItem[]): ExtractedItem[] {
  const byNormalized = new Map<string, { surface: string; evidence: string[] }>();

  for (const item of items) {
    const key = normalizeTerm(item.surface);
    const existing = byNormalized.get(key);
    if (!existing) {
      byNormalized.set(key, { surface: item.surface, evidence: [...new Set(item.evidence)] });
      continue;
    }
    for (const span of item.evidence) {
      if (!existing.evidence.includes(span)) existing.evidence.push(span);
    }
  }

  return [...byNormalized.values()];
}

function summarize(items: SubmittedItem[]): JdSubmissionSummary {
  return {
    total: items.length,
    exact: items.filter((item) => item.tier === 'exact').length,
    containment: items.filter((item) => item.tier === 'containment').length,
    similarity: items.filter((item) => item.tier === 'similarity').length,
    unresolved: items.filter((item) => item.tier === 'unresolved').length,
  };
}
