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

/**
 * How many neighbours each named concept contributes to the adjacent layer.
 *
 * Uncapped "one hop" is not a small set. The corpus is built to a mean degree of ten, so
 * a posting naming nine concepts reached 43 of the 67 -- measured on a real submission,
 * against 9 named-resolved and 25 named-unanswered. Two thirds of the map was then the
 * layer that is supposed to be subordinate to the other two, which is the failure the
 * brief for this change named in advance.
 *
 * Three is a product judgement, not a measurement, and it is written as a constant so it
 * can be moved when someone looks at the map and disagrees. What is *not* a judgement is
 * the ordering the cap applies: authored links first, because a document author asserted
 * them, then inferred by descending similarity.
 */
export const ADJACENT_PER_NAMED = 3;

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
  // material, whose authored edges were written by a document author and are real. Each
  // named concept contributes its strongest few and no more; see ADJACENT_PER_NAMED.
  const candidates = new Map<string, { other: string; kind: string; strength: number }[]>();
  for (const edge of edges) {
    const consider = (from: string, to: string) => {
      if (!namedConcepts.has(from) || namedConcepts.has(to) || !byConceptId.has(to)) return;
      if (!candidates.has(from)) candidates.set(from, []);
      candidates.get(from)!.push({ other: to, kind: edge.kind, strength: edge.strength });
    };
    consider(edge.a, edge.b);
    consider(edge.b, edge.a);
  }

  const adjacent = new Set<string>();
  // Named concepts in a fixed order, so which neighbours survive the cap does not depend
  // on the order the posting happened to mention things in (FR-015).
  for (const conceptId of [...namedConcepts.keys()].sort()) {
    const ranked = (candidates.get(conceptId) ?? []).sort((x, y) => {
      if (x.kind !== y.kind) return x.kind === 'authored' ? -1 : 1;
      return y.strength - x.strength || x.other.localeCompare(y.other);
    });
    for (const entry of ranked.slice(0, ADJACENT_PER_NAMED)) adjacent.add(entry.other);
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
