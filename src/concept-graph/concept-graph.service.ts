import { Injectable, NotFoundException } from '@nestjs/common';

import { NON_CONCEPT_IDS } from '../corpus/non-concept-ids.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CALIBRATION, SIMILARITY_THRESHOLD } from '../resolve/calibration.js';
import { apiTierForRow, type ApiResolutionTier } from '../resolve/resolution-tier.js';
import {
  assembleEdges,
  TARGET_MEAN_DEGREE,
  type ConceptForEdges,
  type GraphEdge,
} from './edge-assembly.js';
import { layerForPosting, type GraphNode, type LayerCounts } from './node-layers.js';

export type { GraphNode } from './node-layers.js';

export interface GraphStats extends LayerCounts {
  nodes: number;
  authoredEdges: number;
  inferredEdges: number;
  meanDegree: number;
  /** The similarity the density target happened to land on for this corpus. */
  inferredCut: number | null;
  /** Usable concepts in the corpus, however few of them this posting reached. */
  corpusConcepts: number;
}

export interface ThresholdRecord {
  value: number;
  baseline: string;
  calibratedAt: string;
}

/** One extracted phrase, as the map reports it: the posting's side of the graph. */
export interface GraphItem {
  surface: string;
  conceptId: string | null;
  tier: ApiResolutionTier;
  evidence: string[];
}

export interface ConceptGraph {
  submissionId: string;
  threshold: ThresholdRecord | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  items: GraphItem[];
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
 * The concept graph for one submission -- the *submission's* graph, derived on request.
 *
 * Nothing is materialised. The 70 vectors produce 2,415 pairwise comparisons, which is
 * microseconds, while a stored edge table would have to be invalidated whenever a concept
 * vector changed (data-model.md, "Derived, not stored").
 *
 * Until 2026-08-22 every concept appeared, at relevance 0 if nothing matched it. That was
 * the wrong map: it made every posting the corpus does not cover produce an identical
 * 67-node picture, and it showed patterns no posting mentioned while showing none of the
 * things postings actually ask for. The node set is now selected by the submission
 * (src/concept-graph/node-layers.ts) and the corpus's size is reported in `stats` instead
 * -- `corpusConcepts` against `offMap` is what keeps a small map legible as "this posting
 * touched little of the corpus" rather than as "the corpus is empty".
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
          select: {
            surface: true,
            normalized: true,
            evidence: true,
            conceptId: true,
            tier: true,
          },
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

    // The whole corpus graph is assembled first and then narrowed. The density target and
    // the cut it lands on are properties of the corpus, not of one posting -- computing
    // them over a five-concept subgraph would make the same pair of concepts adjacent in
    // one submission and not in another.
    const forEdges: ConceptForEdges[] = concepts.map((concept) => ({
      conceptId: concept.conceptId,
      related: concept.related,
      embedding: parseVector(concept.embedding),
      hasCorpus: concept.hasCorpus,
    }));
    const { authored, inferred, inferredCut } = assembleEdges(forEdges, TARGET_MEAN_DEGREE);

    const items = submission.items.filter(
      (item) => item.conceptId === null || !NON_CONCEPT_IDS.has(item.conceptId),
    );
    const { nodes, edges, counts } = layerForPosting(items, concepts, [...authored, ...inferred]);

    const registeredTerms = new Set(
      (
        await this.prisma.conceptTerm.findMany({ select: { term: true } })
      ).map((row) => row.term),
    );

    const authoredKept = edges.filter((edge) => edge.kind === 'authored').length;
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
      edges,
      // Every extracted phrase with the pass that resolved it. The map is now the
      // posting's, so the posting's own item list travels with it rather than only being
      // available to a caller that still holds the POST response.
      items: items.map((item) => ({
        surface: item.surface,
        conceptId: item.conceptId,
        tier: apiTierForRow(item, registeredTerms),
        evidence: item.evidence,
      })),
      stats: {
        ...counts,
        nodes: nodes.length,
        authoredEdges: authoredKept,
        inferredEdges: edges.length - authoredKept,
        meanDegree: nodes.length === 0 ? 0 : (2 * edges.length) / nodes.length,
        inferredCut,
        corpusConcepts: concepts.length,
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
