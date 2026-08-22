/**
 * Turns the graph response into the shape the map draws from.
 *
 * This is the only part of the client with anything to get wrong, so it is a module the
 * page imports rather than script inside it: a browser needs it as plain JavaScript, and
 * a test needs it without a DOM. The hand-written `graph-view-model.d.ts` beside it is
 * what the TypeScript test and `tsc --noEmit` read.
 *
 * The graph is now the posting's rather than the corpus's, and it carries the posting's
 * own items with it -- so the unresolved list no longer has to be joined in from a
 * `POST` response the browser may no longer be holding. The submission response is still
 * accepted, for the item-count summary alone.
 */

/**
 * @param {import('./graph-view-model.js').ConceptGraph} graph
 * @param {import('./graph-view-model.js').SubmissionResult | null} submission
 * @returns {import('./graph-view-model.js').GraphViewModel}
 */
export function buildViewModel(graph, submission) {
  const byId = new Map();
  for (const node of graph.nodes) {
    byId.set(node.id, {
      id: node.id,
      conceptId: node.conceptId,
      name: node.name,
      layer: node.layer,
      hasCorpus: node.hasCorpus,
      relevance: node.relevance,
      matchedItems: node.matchedItems,
      evidence: node.evidence,
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
    // An edge naming a node the list does not carry cannot be drawn. The graph service
    // filters both sides consistently, so this should never fire; dropping the edge
    // rather than inventing a node keeps a backend change from producing a point with no
    // name and no layer.
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
  const inLayer = (layer) => nodes.filter((node) => node.layer === layer);

  return {
    submissionId: graph.submissionId,
    nodes,
    authoredEdges,
    inferredEdges,
    adjacency,
    resolved: inLayer('named-resolved'),
    // Ordered concepts-first, then the phrases nothing in the corpus knows at all. A
    // concept the corpus names but cannot speak to is a different kind of gap from a
    // product name, and the list reads better when the two are not interleaved.
    unanswered: inLayer('named-unanswered').sort(
      (a, b) => Number(a.conceptId === null) - Number(b.conceptId === null),
    ),
    adjacent: inLayer('adjacent'),
    // A posting with nothing recognisable at all: not a failure, but it needs saying in
    // words, because an empty canvas otherwise reads as a broken page.
    emptyMap: nodes.length === 0,
    // Nothing the posting named has material behind it. The map is then entirely hollow
    // points, which is a real answer about this corpus and this role.
    nothingAnswered: inLayer('named-resolved').length === 0,
    summary: submission === null ? null : submission.summary,
    stats: graph.stats,
    thresholdLabel: describeThreshold(graph.threshold),
  };
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
 * The neighbours of one node, authored first and then by descending strength, so a
 * selected node's panel leads with the links a document asserted.
 *
 * @param {import('./graph-view-model.js').GraphViewModel} viewModel
 * @param {string} nodeId
 * @returns {import('./graph-view-model.js').Neighbour[]}
 */
export function neighboursOf(viewModel, nodeId) {
  const entries = viewModel.adjacency.get(nodeId) ?? [];
  return [...entries]
    .map((entry) => {
      const node = viewModel.nodes.find((candidate) => candidate.id === entry.other);
      return {
        id: entry.other,
        name: node?.name ?? entry.other,
        layer: node?.layer ?? 'adjacent',
        kind: entry.kind,
        strength: entry.strength,
      };
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'authored' ? -1 : 1;
      if (b.strength !== a.strength) return b.strength - a.strength;
      return a.id.localeCompare(b.id);
    });
}
