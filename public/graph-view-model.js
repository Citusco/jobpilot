/**
 * Turns the two API responses into the shape the map draws from.
 *
 * This is the only part of the client with anything to get wrong, so it is a module the
 * page imports rather than script inside it: a browser needs it as plain JavaScript, and
 * a test needs it without a DOM. The hand-written `graph-view-model.d.ts` beside it is
 * what the TypeScript test and `tsc --noEmit` read.
 *
 * The graph endpoint deliberately carries no unresolved items -- it is a map of concepts,
 * and an unresolved item resolved to no concept. They come from the submission response
 * instead, and the two are joined here, because a map without them is identical for every
 * posting the corpus does not cover.
 */

/**
 * @param {import('./graph-view-model.js').ConceptGraph} graph
 * @param {import('./graph-view-model.js').SubmissionResult | null} submission
 * @returns {import('./graph-view-model.js').GraphViewModel}
 */
export function buildViewModel(graph, submission) {
  const byId = new Map();
  for (const node of graph.nodes) {
    byId.set(node.conceptId, {
      conceptId: node.conceptId,
      name: node.name,
      hasCorpus: node.hasCorpus,
      relevance: node.relevance,
      matchedItems: node.matchedItems,
      authoredDegree: 0,
      inferredDegree: 0,
      degree: 0,
    });
  }

  /** @type {Map<string, {other: string, kind: string, strength: number}[]>} */
  const adjacency = new Map();
  const authoredEdges = [];
  const inferredEdges = [];

  for (const edge of graph.edges) {
    // An edge naming a concept the node list does not carry cannot be drawn. The graph
    // service filters non-concept ids out of both, so this should never fire; dropping
    // the edge rather than inventing a node keeps a backend change from silently
    // producing a node with no name and no corpus flag.
    if (!byId.has(edge.a) || !byId.has(edge.b)) continue;

    (edge.kind === 'authored' ? authoredEdges : inferredEdges).push(edge);

    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (edge.kind === 'authored') {
      a.authoredDegree += 1;
      b.authoredDegree += 1;
    } else {
      a.inferredDegree += 1;
      b.inferredDegree += 1;
    }
    a.degree += 1;
    b.degree += 1;

    if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
    if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);
    adjacency.get(edge.a).push({ other: edge.b, kind: edge.kind, strength: edge.strength });
    adjacency.get(edge.b).push({ other: edge.a, kind: edge.kind, strength: edge.strength });
  }

  const nodes = [...byId.values()];
  const matched = nodes.filter((node) => node.relevance > 0);

  return {
    submissionId: graph.submissionId,
    nodes,
    authoredEdges,
    inferredEdges,
    adjacency,
    matchedCount: matched.length,
    // Every node at relevance 0 is the common case, not a failure, and the page says so
    // in words rather than showing a uniformly grey map with no explanation.
    allUnmatched: matched.length === 0,
    withoutCorpusCount: nodes.filter((node) => !node.hasCorpus).length,
    unresolved: collectUnresolved(submission),
    unresolvedAvailable: submission !== null,
    summary: submission === null ? null : submission.summary,
    stats: graph.stats,
    thresholdLabel: describeThreshold(graph.threshold),
  };
}

/**
 * The unresolved items, deduplicated by surface form and ordered by first appearance.
 *
 * Two extracted spans can produce the same surface with different casing; they are the
 * same gap and are listed once, keeping the first casing seen rather than lowercasing,
 * since the surface is the posting's own wording.
 *
 * @param {import('./graph-view-model.js').SubmissionResult | null} submission
 * @returns {import('./graph-view-model.js').UnresolvedItem[]}
 */
export function collectUnresolved(submission) {
  if (submission === null) return [];
  /** @type {Map<string, import('./graph-view-model.js').UnresolvedItem>} */
  const bySurface = new Map();
  for (const item of submission.items) {
    if (item.tier !== 'unresolved') continue;
    const key = item.surface.trim().toLowerCase();
    if (key === '') continue;
    const existing = bySurface.get(key);
    if (existing === undefined) {
      bySurface.set(key, {
        surface: item.surface.trim(),
        score: item.score,
        evidence: [...new Set(item.evidence)],
      });
      continue;
    }
    for (const span of item.evidence) {
      if (!existing.evidence.includes(span)) existing.evidence.push(span);
    }
    if (existing.score === null || (item.score !== null && item.score > existing.score)) {
      existing.score = item.score;
    }
  }
  return [...bySurface.values()];
}

/**
 * What to print where a threshold would go.
 *
 * `null` is a result, not a missing value: the calibration ran, found the two baselines
 * do not separate, and declined to invent a number. Rendering it as an error or a dash
 * would misreport that, so it gets a sentence.
 *
 * @param {import('./graph-view-model.js').ThresholdRecord | null | undefined} threshold
 * @returns {string}
 */
export function describeThreshold(threshold) {
  if (threshold === null || threshold === undefined) {
    return 'none in force — calibration found no separation, so there is no similarity tier';
  }
  return `${threshold.value.toFixed(4)} (baseline: ${threshold.baseline})`;
}

/**
 * The neighbours of one concept, authored first and then by descending strength, so a
 * selected node's panel leads with the links a document asserted.
 *
 * @param {import('./graph-view-model.js').GraphViewModel} viewModel
 * @param {string} conceptId
 * @returns {import('./graph-view-model.js').Neighbour[]}
 */
export function neighboursOf(viewModel, conceptId) {
  const entries = viewModel.adjacency.get(conceptId) ?? [];
  return [...entries]
    .map((entry) => ({
      conceptId: entry.other,
      name: viewModel.nodes.find((node) => node.conceptId === entry.other)?.name ?? entry.other,
      kind: entry.kind,
      strength: entry.strength,
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'authored' ? -1 : 1;
      if (b.strength !== a.strength) return b.strength - a.strength;
      return a.conceptId.localeCompare(b.conceptId);
    });
}
