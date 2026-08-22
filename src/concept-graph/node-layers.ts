import type { GraphEdge } from './edge-assembly.js';

/**
 * Which nodes a submission's map is made of.
 *
 * Pure functions over a submission's items, the corpus concepts and an already-assembled
 * edge set: no Prisma, no Nest, no I/O. Same reasoning as edge-assembly -- the selection
 * rule is the part of this feature most likely to go quietly wrong, and it is only
 * checkable if it can be run against a shape a test chose.
 *
 * The map used to be the corpus with the posting in a side panel. Measured consequences:
 * a posting naming Go, GraphQL, Kafka and Kubernetes showed none of them; a posting the
 * corpus does not cover produced the same 67-node map as every other posting, carrying no
 * information about the submission at all; and every map showed Valet Key, Leader
 * Election and Static Content Hosting whether or not anything mentioned them.
 */

export type NodeLayer = 'named-resolved' | 'named-unanswered' | 'adjacent';

/** One stored `extracted_items` row, reduced to what node selection needs. */
export interface PostingItem {
  surface: string;
  normalized: string;
  conceptId: string | null;
  evidence: string[];
}

export interface ConceptFacts {
  conceptId: string;
  name: string;
  hasCorpus: boolean;
}

export interface GraphNode {
  /** The concept id, or `item:<normalized>` for a phrase no concept answered. */
  id: string;
  conceptId: string | null;
  name: string;
  layer: NodeLayer;
  hasCorpus: boolean;
  relevance: number;
  matchedItems: string[];
  /** The posting's own wording, for a named phrase nothing answered. Empty otherwise. */
  evidence: string[];
}

export interface LayerCounts {
  namedResolved: number;
  namedUnanswered: number;
  adjacent: number;
  /** Concepts the corpus holds that this map does not draw. */
  offMap: number;
}

export interface LayeredGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  counts: LayerCounts;
}

/**
 * Select the posting's map from the corpus's.
 *
 * - **named-resolved**: the posting named it and a concept with material answers it.
 * - **named-unanswered**: the posting named it and nothing in the corpus does. Two things
 *   land here -- a phrase that resolved to nothing (`Go`, `Kafka`, `Kubernetes`, which are
 *   product names and must never become concepts), and a concept the corpus knows of but
 *   has no material for. Both are honestly empty, and both belong on the map rather than
 *   beside it.
 * - **adjacent**: one hop from a concept the posting named. This is the layer that says
 *   what the role implies but the posting did not spell out, and it is deliberately
 *   subordinate to the other two.
 *
 * An item whose concept the corpus no longer carries -- a deleted concept, or one of the
 * navigation pages filtered out upstream -- is dropped rather than turned into a node.
 * Inventing a node for an id with no name and no corpus flag would put an unlabelled point
 * on the map, which reads as a rendering fault rather than as information.
 */
export function layerForPosting(
  items: readonly PostingItem[],
  concepts: readonly ConceptFacts[],
  edges: readonly GraphEdge[],
): LayeredGraph {
  const byConceptId = new Map(concepts.map((concept) => [concept.conceptId, concept]));

  const namedConcepts = new Map<string, string[]>();
  const unmatched: PostingItem[] = [];
  for (const item of items) {
    if (item.conceptId !== null && byConceptId.has(item.conceptId)) {
      namedConcepts.set(item.conceptId, [
        ...(namedConcepts.get(item.conceptId) ?? []),
        item.surface,
      ]);
      continue;
    }
    if (item.conceptId === null) unmatched.push(item);
  }

  // One hop, from anything the posting named -- including a named concept with no
  // material, whose authored edges were written by a document author and are real.
  const adjacent = new Set<string>();
  for (const edge of edges) {
    if (namedConcepts.has(edge.a) && !namedConcepts.has(edge.b) && byConceptId.has(edge.b)) {
      adjacent.add(edge.b);
    }
    if (namedConcepts.has(edge.b) && !namedConcepts.has(edge.a) && byConceptId.has(edge.a)) {
      adjacent.add(edge.a);
    }
  }

  const conceptNodes: GraphNode[] = [];
  for (const [conceptId, surfaces] of namedConcepts) {
    const concept = byConceptId.get(conceptId)!;
    conceptNodes.push({
      id: conceptId,
      conceptId,
      name: concept.name,
      // Named, but nothing behind it: the corpus knows the word and can say nothing.
      layer: concept.hasCorpus ? 'named-resolved' : 'named-unanswered',
      hasCorpus: concept.hasCorpus,
      // A recorded name, not a measurement. Both matching passes are exact lookups
      // against `concept_terms`, so both contribute the same; scoring the containment
      // pass lower would mean inventing the number FR-016 forbids.
      relevance: 1,
      matchedItems: surfaces,
      evidence: [],
    });
  }
  for (const conceptId of adjacent) {
    const concept = byConceptId.get(conceptId)!;
    conceptNodes.push({
      id: conceptId,
      conceptId,
      name: concept.name,
      layer: 'adjacent',
      hasCorpus: concept.hasCorpus,
      relevance: 0,
      matchedItems: [],
      evidence: [],
    });
  }

  const itemNodes: GraphNode[] = unmatched.map((item) => ({
    id: `item:${item.normalized}`,
    conceptId: null,
    name: item.surface,
    layer: 'named-unanswered',
    // Nothing at all is behind it: not a concept, so not even a name in the corpus.
    hasCorpus: false,
    relevance: 1,
    matchedItems: [item.surface],
    evidence: item.evidence,
  }));

  const nodes = [...conceptNodes, ...itemNodes].sort((a, b) => a.id.localeCompare(b.id));
  const drawn = new Set(nodes.map((node) => node.id));

  // Edges join concepts, never items, and only where one end is something the posting
  // named. An edge between two adjacent concepts is two hops from the submission; drawing
  // those turns the subordinate layer into the densest thing on the map.
  const keptEdges = edges.filter(
    (edge) =>
      drawn.has(edge.a) &&
      drawn.has(edge.b) &&
      (namedConcepts.has(edge.a) || namedConcepts.has(edge.b)),
  );

  return {
    nodes,
    edges: [...keptEdges],
    counts: {
      namedResolved: conceptNodes.filter((node) => node.layer === 'named-resolved').length,
      namedUnanswered:
        conceptNodes.filter((node) => node.layer === 'named-unanswered').length + itemNodes.length,
      adjacent: adjacent.size,
      offMap: concepts.length - (namedConcepts.size + adjacent.size),
    },
  };
}
