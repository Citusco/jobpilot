import { layerForPosting } from '../../../src/concept-graph/node-layers.js';
import type { GraphEdge } from '../../../src/concept-graph/edge-assembly.js';

/**
 * The map is the posting's, not the corpus's.
 *
 * Measured on the real graph before this: a posting naming Go, GraphQL, Kafka and
 * Kubernetes showed none of them, a posting the corpus does not cover produced the same
 * 67-node map as every other, and the map showed Valet Key and Leader Election, which no
 * posting mentioned. The node set is now selected by the submission, in three layers that
 * a reader has to be able to tell apart:
 *
 *   named-resolved     the posting named it and a concept with material answers it
 *   named-unanswered   the posting named it and nothing in the corpus does
 *   adjacent           the posting did not name it, but it is one hop from something
 *                      that did -- what the role implies but the posting left unsaid
 *
 * Edges join concepts only. An unmatched item has no edges, and that isolation is the
 * correct reading of it.
 */

const CONCEPTS = [
  { conceptId: 'throttling', name: 'Throttling', hasCorpus: true },
  { conceptId: 'rate-limiting', name: 'Rate Limiting', hasCorpus: true },
  { conceptId: 'circuit-breaker', name: 'Circuit Breaker', hasCorpus: true },
  { conceptId: 'retry', name: 'Retry', hasCorpus: true },
  { conceptId: 'bulkhead', name: 'Bulkhead', hasCorpus: true },
  { conceptId: 'valet-key', name: 'Valet Key', hasCorpus: true },
  { conceptId: 'leader-election', name: 'Leader Election', hasCorpus: true },
  { conceptId: 'geodes', name: 'Geodes', hasCorpus: false },
];

const EDGES: GraphEdge[] = [
  { a: 'circuit-breaker', b: 'retry', kind: 'authored', strength: 1 },
  { a: 'circuit-breaker', b: 'bulkhead', kind: 'inferred', strength: 0.51 },
  { a: 'rate-limiting', b: 'throttling', kind: 'authored', strength: 1 },
  { a: 'retry', b: 'bulkhead', kind: 'inferred', strength: 0.44 },
  { a: 'valet-key', b: 'leader-election', kind: 'inferred', strength: 0.4 },
  { a: 'geodes', b: 'leader-election', kind: 'authored', strength: 1 },
];

const item = (
  surface: string,
  conceptId: string | null,
  tier: 'exact' | 'unresolved' = conceptId === null ? 'unresolved' : 'exact',
) => ({ surface, normalized: surface.toLowerCase().replace(/[^a-z0-9]/g, ''), conceptId, tier, evidence: [`…${surface}…`] });

const layerOf = (result: ReturnType<typeof layerForPosting>, id: string) =>
  result.nodes.find((node) => node.id === id)?.layer;

describe('layerForPosting: the three layers', () => {
  const result = layerForPosting(
    [item('Circuit Breaker', 'circuit-breaker'), item('Kubernetes', null), item('Geodes', 'geodes')],
    CONCEPTS,
    EDGES,
  );

  it('puts a concept the posting named, with material behind it, in named-resolved', () => {
    expect(layerOf(result, 'circuit-breaker')).toBe('named-resolved');
  });

  it('puts an unresolved phrase on the map as a node of its own, named and unanswered', () => {
    // Go, GraphQL and Kafka are the real content of most postings' unresolved lists. The
    // old map showed none of them; a side panel is not the map.
    expect(layerOf(result, 'item:kubernetes')).toBe('named-unanswered');
    expect(result.nodes.find((node) => node.id === 'item:kubernetes')).toMatchObject({
      conceptId: null,
      name: 'Kubernetes',
      hasCorpus: false,
      evidence: ['…Kubernetes…'],
    });
  });

  it('counts a concept with no material as named-unanswered too, since nothing answers it', () => {
    expect(layerOf(result, 'geodes')).toBe('named-unanswered');
  });

  it('puts a concept one hop from a named one in adjacent', () => {
    expect(layerOf(result, 'retry')).toBe('adjacent');
    expect(layerOf(result, 'bulkhead')).toBe('adjacent');
  });

  it('leaves out a concept the posting neither named nor implies', () => {
    // Valet Key was on every map before this, for every posting, including postings
    // about nothing like it.
    expect(result.nodes.some((node) => node.id === 'valet-key')).toBe(false);
  });

  it('reaches only one hop, not two', () => {
    // `rate-limiting` and `throttling` are a connected pair the posting never touched.
    expect(result.nodes.some((node) => node.id === 'rate-limiting')).toBe(false);
    expect(result.nodes.some((node) => node.id === 'throttling')).toBe(false);
  });

  it('counts each layer, and how much of the corpus is off the map', () => {
    // The off-map count is what keeps an empty result legible: a reader has to be able to
    // see the corpus is larger than what this posting touched, or a two-node map reads
    // as a broken corpus rather than as a posting the corpus does not cover.
    expect(result.counts).toEqual({
      namedResolved: 1,
      namedUnanswered: 2,
      adjacent: 3,
      offMap: 8 - 5,
    });
  });
});

describe('layerForPosting: edges', () => {
  it('keeps an edge only when it touches something the posting named', () => {
    // Adjacency is "one hop from something that resolved". An edge between two adjacent
    // concepts is two hops from the posting, and drawing them turns the subordinate layer
    // into a hairball that outweighs the two layers that matter.
    const result = layerForPosting([item('Circuit Breaker', 'circuit-breaker')], CONCEPTS, EDGES);

    expect(result.edges).toEqual([
      { a: 'circuit-breaker', b: 'retry', kind: 'authored', strength: 1 },
      { a: 'circuit-breaker', b: 'bulkhead', kind: 'inferred', strength: 0.51 },
    ]);
  });

  it('gives an unmatched item no edges at all', () => {
    const result = layerForPosting([item('Kubernetes', null)], CONCEPTS, EDGES);

    expect(result.nodes.map((node) => node.id)).toEqual(['item:kubernetes']);
    expect(result.edges).toEqual([]);
  });

  it('never emits an edge whose endpoint is not a node', () => {
    const result = layerForPosting(
      [item('Circuit Breaker', 'circuit-breaker'), item('Geodes', 'geodes')],
      CONCEPTS,
      EDGES,
    );
    const ids = new Set(result.nodes.map((node) => node.id));

    for (const edge of result.edges) {
      expect(ids.has(edge.a)).toBe(true);
      expect(ids.has(edge.b)).toBe(true);
    }
  });
});

describe('layerForPosting: degenerate postings', () => {
  it('returns an empty map for a posting with no items, rather than the whole corpus', () => {
    const result = layerForPosting([], CONCEPTS, EDGES);

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.counts).toEqual({
      namedResolved: 0,
      namedUnanswered: 0,
      adjacent: 0,
      offMap: 8,
    });
  });

  it('returns a map of isolated points for a posting the corpus does not cover', () => {
    // The old behaviour was an identical 67-node map carrying no information about the
    // submission. This one carries only information about the submission.
    const result = layerForPosting(
      [item('Go', null), item('Kafka', null), item('GraphQL', null)],
      CONCEPTS,
      EDGES,
    );

    expect(result.nodes.map((node) => node.id)).toEqual([
      'item:go',
      'item:graphql',
      'item:kafka',
    ]);
    expect(result.nodes.every((node) => node.layer === 'named-unanswered')).toBe(true);
    expect(result.edges).toEqual([]);
    expect(result.counts.offMap).toBe(8);
  });

  it('merges two phrases that resolved to one concept into one node', () => {
    const result = layerForPosting(
      [item('Circuit Breaker', 'circuit-breaker'), item('circuit breakers', 'circuit-breaker')],
      CONCEPTS,
      EDGES,
    );
    const node = result.nodes.find((n) => n.id === 'circuit-breaker');

    expect(node?.matchedItems).toEqual(['Circuit Breaker', 'circuit breakers']);
    expect(result.counts.namedResolved).toBe(1);
  });

  it('is deterministic: same input, identical output, node order included', () => {
    const build = () =>
      layerForPosting(
        [item('Geodes', 'geodes'), item('Circuit Breaker', 'circuit-breaker'), item('Go', null)],
        CONCEPTS,
        EDGES,
      );

    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('drops an item whose concept the corpus no longer carries, rather than inventing a node', () => {
    const result = layerForPosting([item('Ambassador', 'ambassador')], CONCEPTS, EDGES);

    expect(result.nodes).toEqual([]);
  });
});
