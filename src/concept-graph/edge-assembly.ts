/**
 * Edge assembly for the concept graph.
 *
 * Pure functions over concepts and their vectors: no Prisma, no Nest, no I/O. That is
 * deliberate -- the density rule in FR-013 is the part of this feature most likely to be
 * got wrong quietly, and it is only checkable if it can be run against a distribution
 * chosen by a test rather than only against the corpus as it stands today.
 */

export type EdgeKind = 'authored' | 'inferred';

export interface ConceptForEdges {
  conceptId: string;
  related: string[];
  embedding: number[] | null;
}

export interface GraphEdge {
  a: string;
  b: string;
  kind: EdgeKind;
  strength: number;
}

export interface AssembledEdges {
  /** Asserted by a source document. Never merged with `inferred` (FR-012). */
  authored: GraphEdge[];
  /** Inferred from vector similarity. Disjoint from `authored` by construction. */
  inferred: GraphEdge[];
  /** The lowest similarity admitted, an outcome of the target rather than an input. */
  inferredCut: number | null;
}

/**
 * FR-013's target: approximately ten connections per concept, with none unconnected.
 *
 * A similarity value is deliberately not the knob. Concept-pair similarity is narrow --
 * measured on the 70 real vectors at p5 0.248, p50 0.351, p95 0.484 -- so a fixed cut
 * sits inside the bulk of the distribution, where a small shift in how vectors are built
 * moves the edge count enormously. Targeting a degree makes the value move with the
 * corpus instead.
 */
export const TARGET_MEAN_DEGREE = 10;

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/**
 * Build both edge sets for a set of concepts.
 *
 * Authored edges come first and count towards the target: a relationship a document
 * asserted is the stronger claim, so a pair that is both asserted and similar is
 * reported once, as authored. Emitting it twice would inflate the density and leave a
 * client unable to say what it is looking at.
 *
 * Everything here is deterministic -- candidates are ordered by similarity and then by
 * id, and ties therefore break the same way on every call (FR-015).
 */
export function assembleEdges(
  concepts: ConceptForEdges[],
  targetMeanDegree: number = TARGET_MEAN_DEGREE,
): AssembledEdges {
  const ids = concepts.map((concept) => concept.conceptId).sort((x, y) => x.localeCompare(y));
  const present = new Set(ids);
  const vectors = new Map(
    concepts.filter((c) => c.embedding !== null).map((c) => [c.conceptId, c.embedding!]),
  );

  const authoredKeys = new Set<string>();
  for (const concept of concepts) {
    for (const other of concept.related) {
      // A reference to a concept the graph does not carry, and a self-reference, are
      // both dropped: an edge with one end missing is not drawable.
      if (other === concept.conceptId || !present.has(other)) continue;
      authoredKeys.add(pairKey(concept.conceptId, other));
    }
  }
  const authored = [...authoredKeys].sort().map((key) => {
    const [a, b] = key.split('|');
    // Authored edges have no measured weight. The 1 is a rendering hint, not a claim
    // that the relationship is maximally strong (contracts/http-api.md).
    return { a, b, kind: 'authored' as const, strength: 1 };
  });

  const candidates: GraphEdge[] = [];
  for (let i = 0; i < ids.length; i++) {
    const va = vectors.get(ids[i]);
    if (!va) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const vb = vectors.get(ids[j]);
      if (!vb) continue;
      if (authoredKeys.has(pairKey(ids[i], ids[j]))) continue;
      candidates.push({ a: ids[i], b: ids[j], kind: 'inferred', strength: cosineSimilarity(va, vb) });
    }
  }
  candidates.sort(
    (x, y) => y.strength - x.strength || x.a.localeCompare(y.a) || x.b.localeCompare(y.b),
  );

  const targetEdges = Math.round((targetMeanDegree * ids.length) / 2);
  const take = Math.max(0, Math.min(targetEdges - authored.length, candidates.length));
  const chosen = candidates.slice(0, take);
  const chosenKeys = new Set(chosen.map((edge) => pairKey(edge.a, edge.b)));

  // "with no unconnected concepts" (FR-013). The density target is an average, so it can
  // be met while a concept whose similarities are all weak still has nothing attached to
  // it -- and an unconnected node is precisely what the map is supposed to make visible
  // about the *submission*, not an artefact of where the cut landed.
  const degree = new Map(ids.map((id) => [id, 0]));
  for (const edge of [...authored, ...chosen]) {
    degree.set(edge.a, degree.get(edge.a)! + 1);
    degree.set(edge.b, degree.get(edge.b)! + 1);
  }
  for (const id of ids) {
    if (degree.get(id) !== 0) continue;
    const rescue = candidates.find(
      (edge) => (edge.a === id || edge.b === id) && !chosenKeys.has(pairKey(edge.a, edge.b)),
    );
    if (!rescue) continue;
    chosen.push(rescue);
    chosenKeys.add(pairKey(rescue.a, rescue.b));
    degree.set(rescue.a, degree.get(rescue.a)! + 1);
    degree.set(rescue.b, degree.get(rescue.b)! + 1);
  }

  const inferredCut = chosen.length === 0 ? null : Math.min(...chosen.map((e) => e.strength));

  return {
    authored,
    inferred: chosen.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b)),
    inferredCut,
  };
}

/** Undirected identity for a pair: the two ids in a fixed order. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
