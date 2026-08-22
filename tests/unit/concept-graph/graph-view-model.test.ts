import {
  buildViewModel,
  collectUnresolved,
  describeThreshold,
  neighboursOf,
} from '../../../public/graph-view-model.js';
import type {
  ConceptGraph,
  SubmissionResult,
} from '../../../public/graph-view-model.js';

function graph(overrides: Partial<ConceptGraph> = {}): ConceptGraph {
  return {
    submissionId: 'sub-1',
    threshold: null,
    nodes: [
      { conceptId: 'throttling', name: 'Throttling', hasCorpus: true, relevance: 1, matchedItems: ['throttling'] },
      { conceptId: 'caching', name: 'Caching', hasCorpus: false, relevance: 0, matchedItems: [] },
      { conceptId: 'sharding', name: 'Sharding', hasCorpus: true, relevance: 0.5, matchedItems: ['shard'] },
      { conceptId: 'bulkhead', name: 'Bulkhead', hasCorpus: true, relevance: 0, matchedItems: [] },
    ],
    edges: [
      { a: 'throttling', b: 'caching', kind: 'authored', strength: 1 },
      { a: 'throttling', b: 'sharding', kind: 'inferred', strength: 0.62 },
      { a: 'caching', b: 'sharding', kind: 'inferred', strength: 0.41 },
    ],
    stats: { nodes: 4, authoredEdges: 1, inferredEdges: 2, meanDegree: 1.5, inferredCut: 0.41 },
    ...overrides,
  };
}

function submission(overrides: Partial<SubmissionResult> = {}): SubmissionResult {
  return {
    submissionId: 'sub-1',
    items: [
      { surface: 'throttling', conceptId: 'throttling', tier: 'exact', score: null, evidence: ['a'] },
      { surface: 'Kubernetes', conceptId: null, tier: 'unresolved', score: 0.28, evidence: ['b'] },
      { surface: 'kubernetes', conceptId: null, tier: 'unresolved', score: 0.31, evidence: ['c'] },
      { surface: 'Terraform', conceptId: null, tier: 'unresolved', score: null, evidence: ['d', 'd'] },
    ],
    summary: { total: 4, exact: 1, similarity: 0, unresolved: 3 },
    ...overrides,
  };
}

describe('buildViewModel', () => {
  it('keeps the two edge kinds apart and counts degree per kind', () => {
    const model = buildViewModel(graph(), submission());

    expect(model.authoredEdges).toHaveLength(1);
    expect(model.inferredEdges).toHaveLength(2);
    expect(model.authoredEdges.every((edge) => edge.kind === 'authored')).toBe(true);
    expect(model.inferredEdges.every((edge) => edge.kind === 'inferred')).toBe(true);

    const throttling = model.nodes.find((node) => node.conceptId === 'throttling');
    expect(throttling).toMatchObject({ authoredDegree: 1, inferredDegree: 1, degree: 2 });
  });

  it('carries every node through, including ones nothing matched and ones with no edges', () => {
    const model = buildViewModel(graph(), submission());

    expect(model.nodes).toHaveLength(4);
    expect(model.nodes.map((node) => node.conceptId)).toContain('bulkhead');
    expect(model.nodes.find((node) => node.conceptId === 'bulkhead')?.degree).toBe(0);
    expect(model.adjacency.get('bulkhead')).toBeUndefined();
  });

  it('reports how many concepts have no corpus material behind them', () => {
    expect(buildViewModel(graph(), submission()).withoutCorpusCount).toBe(1);
  });

  it('flags the all-unmatched map, which is the common case for a real posting', () => {
    const populated = buildViewModel(graph(), submission());
    expect(populated.allUnmatched).toBe(false);
    expect(populated.matchedCount).toBe(2);

    const flat = graph({
      nodes: graph().nodes.map((node) => ({ ...node, relevance: 0, matchedItems: [] })),
    });
    const empty = buildViewModel(flat, submission());
    expect(empty.allUnmatched).toBe(true);
    expect(empty.matchedCount).toBe(0);
  });

  it('drops an edge naming a concept the node list does not carry', () => {
    const model = buildViewModel(
      graph({
        edges: [
          { a: 'throttling', b: 'ghost', kind: 'authored', strength: 1 },
          { a: 'throttling', b: 'caching', kind: 'authored', strength: 1 },
        ],
      }),
      submission(),
    );

    expect(model.authoredEdges).toHaveLength(1);
    expect(model.nodes.map((node) => node.conceptId)).not.toContain('ghost');
    expect(model.nodes.find((node) => node.conceptId === 'throttling')?.degree).toBe(1);
  });

  it('marks unresolved items unavailable when there is no submission response', () => {
    const model = buildViewModel(graph(), null);

    expect(model.unresolvedAvailable).toBe(false);
    expect(model.unresolved).toEqual([]);
    expect(model.summary).toBeNull();
  });
});

describe('collectUnresolved', () => {
  it('lists only unresolved items, deduplicated by surface, keeping the first casing', () => {
    const items = collectUnresolved(submission());

    expect(items.map((item) => item.surface)).toEqual(['Kubernetes', 'Terraform']);
  });

  it('merges the evidence of duplicate surfaces and keeps the strongest score', () => {
    const [kubernetes, terraform] = collectUnresolved(submission());

    expect(kubernetes.evidence).toEqual(['b', 'c']);
    expect(kubernetes.score).toBe(0.31);
    expect(terraform.evidence).toEqual(['d']);
    expect(terraform.score).toBeNull();
  });

  it('returns nothing for a submission that resolved everything, and for none at all', () => {
    expect(
      collectUnresolved(
        submission({
          items: [
            { surface: 'throttling', conceptId: 'throttling', tier: 'exact', score: null, evidence: [] },
          ],
        }),
      ),
    ).toEqual([]);
    expect(collectUnresolved(null)).toEqual([]);
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
    const model = buildViewModel(
      graph({
        edges: [
          { a: 'throttling', b: 'sharding', kind: 'inferred', strength: 0.62 },
          { a: 'throttling', b: 'bulkhead', kind: 'inferred', strength: 0.71 },
          { a: 'throttling', b: 'caching', kind: 'authored', strength: 1 },
        ],
      }),
      submission(),
    );

    expect(neighboursOf(model, 'throttling')).toEqual([
      { conceptId: 'caching', name: 'Caching', kind: 'authored', strength: 1 },
      { conceptId: 'bulkhead', name: 'Bulkhead', kind: 'inferred', strength: 0.71 },
      { conceptId: 'sharding', name: 'Sharding', kind: 'inferred', strength: 0.62 },
    ]);
  });

  it('returns nothing for an unconnected concept', () => {
    expect(neighboursOf(buildViewModel(graph(), submission()), 'bulkhead')).toEqual([]);
  });
});
