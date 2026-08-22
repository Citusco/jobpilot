import { Injectable, NotFoundException } from '@nestjs/common';

import { NON_CONCEPT_IDS } from '../corpus/non-concept-ids.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CALIBRATION, SIMILARITY_THRESHOLD } from '../resolve/calibration.js';
import {
  assembleEdges,
  TARGET_MEAN_DEGREE,
  type ConceptForEdges,
  type GraphEdge,
} from './edge-assembly.js';

export interface GraphNode {
  conceptId: string;
  name: string;
  /** false marks a concept the corpus knows of but has no material for. */
  hasCorpus: boolean;
  relevance: number;
  matchedItems: string[];
}

export interface GraphStats {
  nodes: number;
  authoredEdges: number;
  inferredEdges: number;
  meanDegree: number;
  /** The similarity the density target happened to land on for this corpus. */
  inferredCut: number | null;
}

export interface ThresholdRecord {
  value: number;
  baseline: string;
  calibratedAt: string;
}

export interface ConceptGraph {
  submissionId: string;
  threshold: ThresholdRecord | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

interface ConceptRow {
  conceptId: string;
  name: string;
  hasCorpus: boolean;
  related: string[];
  embedding: string | null;
}

/**
 * The whole concept graph for one submission, derived on every request.
 *
 * Nothing here is materialised. The 70 vectors produce 2,415 pairwise comparisons, which
 * is microseconds, while a stored edge table would have to be invalidated whenever a
 * concept vector changed -- a standing correctness hazard bought in exchange for nothing
 * measurable (data-model.md, "Derived, not stored").
 *
 * Every concept appears, including the ones nothing in the posting resolved to, at
 * relevance 0 (FR-011). Returning only the matched subgraph would answer the wrong
 * question: the point of the map is what a candidate is *not* covered on.
 */
@Injectable()
export class ConceptGraphService {
  constructor(private readonly prisma: PrismaService) {}

  async graphFor(submissionId: string): Promise<ConceptGraph> {
    const submission = await this.prisma.jdSubmission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        items: {
          select: { surface: true, conceptId: true, tier: true, score: true },
          orderBy: { normalized: 'asc' },
        },
      },
    });
    if (!submission) {
      throw new NotFoundException({ message: `No submission ${submissionId}` });
    }

    const concepts = (await this.readConcepts()).filter(
      (concept) => !NON_CONCEPT_IDS.has(concept.conceptId),
    );

    const relevance = new Map<string, number>();
    const matchedItems = new Map<string, string[]>();
    for (const item of submission.items) {
      if (item.conceptId === null || NON_CONCEPT_IDS.has(item.conceptId)) continue;
      // An exact match is a recorded name, not a measurement, so it contributes full
      // relevance; a similarity match contributes its score. A concept named twice is no
      // more relevant than a concept named once by the strongest of the two -- counting
      // mentions would make a posting's repetitiveness look like emphasis.
      const contribution = item.tier === 'exact' ? 1 : (item.score ?? 0);
      relevance.set(item.conceptId, Math.max(relevance.get(item.conceptId) ?? 0, contribution));
      matchedItems.set(item.conceptId, [
        ...(matchedItems.get(item.conceptId) ?? []),
        item.surface,
      ]);
    }

    const nodes: GraphNode[] = concepts
      .map((concept) => ({
        conceptId: concept.conceptId,
        name: concept.name,
        hasCorpus: concept.hasCorpus,
        relevance: relevance.get(concept.conceptId) ?? 0,
        matchedItems: matchedItems.get(concept.conceptId) ?? [],
      }))
      .sort((a, b) => a.conceptId.localeCompare(b.conceptId));

    const forEdges: ConceptForEdges[] = concepts.map((concept) => ({
      conceptId: concept.conceptId,
      related: concept.related,
      embedding: parseVector(concept.embedding),
      hasCorpus: concept.hasCorpus,
    }));
    const { authored, inferred, inferredCut } = assembleEdges(forEdges, TARGET_MEAN_DEGREE);

    return {
      submissionId: submission.id,
      // The calibration has been run (docs/calibration/resolve-threshold.json) and found
      // no separation between its two baselines, so there is no threshold in force to
      // echo. Null says that; a placeholder number would be read as a measurement
      // (FR-016, FR-018, FR-019b).
      threshold:
        SIMILARITY_THRESHOLD === null
          ? null
          : {
              value: SIMILARITY_THRESHOLD,
              baseline: CALIBRATION.baseline,
              calibratedAt: CALIBRATION.calibratedAt,
            },
      nodes,
      edges: [...authored, ...inferred],
      stats: {
        nodes: nodes.length,
        authoredEdges: authored.length,
        inferredEdges: inferred.length,
        meanDegree: nodes.length === 0 ? 0 : (2 * (authored.length + inferred.length)) / nodes.length,
        inferredCut,
      },
    };
  }

  /**
   * Prisma cannot select a `vector` column -- it is `Unsupported(...)` in the schema --
   * so the vectors come back as their text form and are parsed here. `related`, `name`
   * and `hasCorpus` ride along in the same query to keep this to one round trip.
   */
  private readConcepts(): Promise<ConceptRow[]> {
    return this.prisma.$queryRaw<ConceptRow[]>`
      SELECT concept_id AS "conceptId",
             name,
             has_corpus AS "hasCorpus",
             related,
             embedding::text AS embedding
      FROM concepts
      ORDER BY concept_id
    `;
  }
}

function parseVector(text: string | null): number[] | null {
  if (text === null) return null;
  return JSON.parse(text) as number[];
}
