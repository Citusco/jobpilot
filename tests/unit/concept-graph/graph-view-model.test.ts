import {
  buildViewModel,
  describeThreshold,
  neighboursOf,
} from '../../../public/graph-view-model.js';
import type { ConceptGraph, SubmissionResult } from '../../../public/graph-view-model.js';

/**
 * The client's transform, now that the graph is the posting's map.
 *
 * The physics is deliberately not tested -- a spring embedder has no correct answer to
 * assert, and pinning coordinates would only pin the constants. What is testable is
 * everything between the response and the drawing: the three layers, the degree counts
 * per edge kind, and the two states the page has to describe in words rather than draw.
 */

function graph(overrides: Partial<ConceptGraph> = {}): ConceptGraph {
  return {
    submissionId: 'sub-1',
    threshold: null,
    nodes: [
      {
        id: 'throttling',
        conceptId: 'throttling',
        name: 'Throttling',
        layer: 'named-resolved',
        hasCorpus: true,
        relevance: 1,
        matchedItems: ['throttling'],
        evidence: [],
      },
      {
        id: 'caching',
        conceptId: 'caching',
        name: 'Caching',
        layer: 'named-unanswered',
        hasCorpus: false,
        relevance: 1,
        matchedItems: ['caching'],
        evidence: [],
      },
      {
        id: 'item:kubernetes',
        conceptId: null,
        name: 'Kubernetes',
        layer: 'named-unanswered',
        hasCorpus: false,
        relevance: 1,
        matchedItems: ['Kubernetes'],
        evidence: ['run Kubernetes in production'],
      },
      {
        id: 'sharding',
        conceptId: 'sharding',
        name: 'Sharding',
        layer: 'adjacent',
        hasCorpus: true,
        relevance: 0,
        matchedItems: [],
        evidence: [],
      },
      {
        id: 'bulkhead',
        conceptId: 'bulkhead',
        name: 'Bulkhead',
        layer: 'adjacent',
        hasCorpus: true,
        relevance: 0,
        matchedItems: [],
        evidence: [],
      },
    ],
    edges: [
      { a: 'caching', b: 'throttling', kind: 'authored', strength: 1 },
      { a: 'sharding', b: 'throttling', kind: 'inferred', strength: 0.62 },
      { a: 'bulkhead', b: 'throttling', kind: 'inferred', strength: 0.41 },
    ],
    items: [
      { surface: 'throttling', conceptId: 'throttling', tier: 'exact', evidence: ['a'] },
      { surface: 'caching', conceptId: 'caching', tier: 'containment', evidence: ['b'] },
      { surface: 'Kubernetes', conceptId: null, tier: 'unresolved', evidence: ['c'] },
    ],
    stats: {
      nodes: 5,
      authoredEdges: 1,
      inferredEdges: 2,
      meanDegree: 1.2,
      inferredCut: 0.41,
      namedResolved: 1,
      namedUnanswered: 2,
      adjacent: 2,
      offMap: 62,
      corpusConcepts: 67,
    },
    ...overrides,
  };
}

function submission(overrides: Partial<SubmissionResult> = {}): SubmissionResult {
  return {
    submissionId: 'sub-1',
    items: [
      { surface: 'throttling', conceptId: 'throttling', tier: 'exact', score: null, evidence: ['a'] },
      { surface: 'caching', conceptId: 'caching', tier: 'containment', score: null, evidence: ['b'] },
      { surface: 'Kubernetes', conceptId: null, tier: 'unresolved', score: null, evidence: ['c'] },
    ],
    summary: { total: 3, exact: 1, containment: 1, similarity: 0, unresolved: 1 },
    ...overrides,
  };
}

describe('buildViewModel', () => {
  it('splits the nodes into the three layers the map draws differently', () => {
    const model = buildViewModel(graph(), submission());

    expect(model.resolved.map((node) => node.id)).toEqual(['throttling']);
    expect(model.unanswered.map((node) => node.id)).toEqual(['caching', 'item:kubernetes']);
    expect(model.adjacent.map((node) => node.id)).toEqual(['sharding', 'bulkhead']);
  });

  it('orders the unanswered list concepts first, bare phrases after', () => {
    // A concept the corpus names but has no material for is a different kind of gap from
    // a product name it has never heard of, and interleaving the two hides that.
    const model = buildViewModel(graph(), submission());

    expect(model.unanswered.map((node) => node.conceptId)).toEqual(['caching', null]);
  });

  it('keeps the two edge kinds apart and counts degree per kind', () => {
    const model = buildViewModel(graph(), submission());

    expect(model.authoredEdges).toHaveLength(1);
    expect(model.inferredEdges).toHaveLength(2);
    expect(model.nodes.find((node) => node.id === 'throttling')).toMatchObject({
      authoredDegree: 1,
      inferredDegree: 2,
      degree: 3,
    });
  });

  it('gives an unmatched item no edges, and keeps it a node anyway', () => {
    const model = buildViewModel(graph(), submission());

    expect(model.nodes.find((node) => node.id === 'item:kubernetes')?.degree).toBe(0);
    expect(model.adjacency.get('item:kubernetes')).toBeUndefined();
    expect(model.nodes.find((node) => node.id === 'item:kubernetes')?.evidence).toEqual([
      'run Kubernetes in production',
    ]);
  });

  it('drops an edge naming a node the list does not carry', () => {
    const model = buildViewModel(
      graph({
        edges: [
          { a: 'throttling', b: 'ghost', kind: 'authored', strength: 1 },
          { a: 'caching', b: 'throttling', kind: 'authored', strength: 1 },
        ],
      }),
      submission(),
    );

    expect(model.authoredEdges).toHaveLength(1);
    expect(model.nodes.map((node) => node.id)).not.toContain('ghost');
    expect(model.nodes.find((node) => node.id === 'throttling')?.degree).toBe(1);
  });

  it('flags a posting with nothing recognisable in it, which draws no map at all', () => {
    const model = buildViewModel(graph({ nodes: [], edges: [], items: [] }), submission());

    expect(model.emptyMap).toBe(true);
    expect(model.nothingAnswered).toBe(true);
  });

  it('flags a map where everything named is hollow, which is a real answer', () => {
    // A posting entirely of product names. Every point is named-unanswered, and the page
    // has to say so in words -- an all-hollow canvas otherwise reads as a broken render.
    const hollow = graph({
      nodes: graph().nodes.filter((node) => node.layer === 'named-unanswered'),
      edges: [],
    });
    const model = buildViewModel(hollow, submission());

    expect(model.emptyMap).toBe(false);
    expect(model.nothingAnswered).toBe(true);
    expect(model.resolved).toEqual([]);
  });

  it('works from the graph alone, with no submission response to join', () => {
    // The gap list used to come only from the POST response, so reopening a stored graph
    // lost it. It is in the graph now; only the item-count summary needs the response.
    const model = buildViewModel(graph(), null);

    expect(model.unanswered.map((node) => node.name)).toEqual(['Caching', 'Kubernetes']);
    expect(model.summary).toBeNull();
  });
});

describe('describeThreshold', () => {
  it('says a null threshold is a finding, not a missing value', () => {
    const label = describeThreshold(null);

    expect(label).toContain('no separation');
    expect(label).not.toMatch(/error|unknown|n\/a/i);
  });

  it('prints a real threshold with the baseline that produced it', () => {
    expect(
      describeThreshold({ value: 0.44, baseline: 'concept-document', calibratedAt: '2026-08-21' }),
    ).toBe('0.4400 (baseline: concept-document)');
  });
});

describe('neighboursOf', () => {
  it('leads with authored links, then inferred by descending strength', () => {
    const model = buildViewModel(graph(), submission());

    expect(neighboursOf(model, 'throttling')).toEqual([
      { id: 'caching', name: 'Caching', layer: 'named-unanswered', kind: 'authored', strength: 1 },
      { id: 'sharding', name: 'Sharding', layer: 'adjacent', kind: 'inferred', strength: 0.62 },
      { id: 'bulkhead', name: 'Bulkhead', layer: 'adjacent', kind: 'inferred', strength: 0.41 },
    ]);
  });

  it('returns nothing for a node with no edges', () => {
    expect(neighboursOf(buildViewModel(graph(), submission()), 'item:kubernetes')).toEqual([]);
  });
});
