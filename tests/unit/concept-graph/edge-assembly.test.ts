import 'dotenv/config';

import {
  assembleEdges,
  cosineSimilarity,
  TARGET_MEAN_DEGREE,
  type ConceptForEdges,
} from '../../../src/concept-graph/edge-assembly.js';
import { NON_CONCEPT_IDS } from '../../../src/corpus/non-concept-ids.js';
import { PrismaClient } from '../../../src/generated/prisma/client.js';

/**
 * Edge assembly: the two kinds and the density target.
 *
 * The synthetic cases pin the rules (FR-012, FR-013, FR-014); the real-corpus cases at
 * the bottom pin the measured figures, because a density target is only meaningful
 * against the distribution it was chosen for -- the concept-pair similarities are narrow
 * (p5 0.248, p50 0.351, p95 0.484), which is exactly why FR-013 forbids fixing a
 * similarity value and requires targeting a degree instead.
 */

/** A point on the unit circle: cosine similarity between two of them is cos(theta_i - theta_j). */
const onCircle = (conceptId: string, theta: number, related: string[] = []): ConceptForEdges => ({
  conceptId,
  related,
  embedding: [Math.cos(theta), Math.sin(theta)],
  hasCorpus: true,
});

const key = (edge: { a: string; b: string }) => `${edge.a}|${edge.b}`;

describe('cosineSimilarity', () => {
  it('is 1 for identical direction and 0 for orthogonal, regardless of magnitude', () => {
    expect(cosineSimilarity([1, 0], [3, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 5])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });
});

describe('authored edges', () => {
  const concepts: ConceptForEdges[] = [
    onCircle('a', 0, ['b', 'b', 'a', 'nowhere']),
    onCircle('b', 0.5, ['a']),
    onCircle('c', 1.0, []),
  ];

  it('come from `related`, undirected, deduplicated, with strength 1', () => {
    const { authored } = assembleEdges(concepts, 0);

    // a->b and b->a are one edge; the repeat, the self-reference and the reference to a
    // concept that is not in the graph all vanish.
    expect(authored).toEqual([{ a: 'a', b: 'b', kind: 'authored', strength: 1 }]);
  });

  it('are present with no vectors at all, since they are asserted rather than measured', () => {
    const withoutVectors = concepts.map((concept) => ({ ...concept, embedding: null }));

    const { authored, inferred } = assembleEdges(withoutVectors, TARGET_MEAN_DEGREE);

    expect(authored).toHaveLength(1);
    expect(inferred).toEqual([]);
  });
});

describe('the two edge kinds never merge (FR-012)', () => {
  const concepts: ConceptForEdges[] = [
    onCircle('a', 0, ['b']),
    onCircle('b', 0.1),
    onCircle('c', 0.2),
    onCircle('d', 0.3),
  ];

  it('returns them as separate lists, each edge labelled with its kind', () => {
    const { authored, inferred } = assembleEdges(concepts, TARGET_MEAN_DEGREE);

    expect(authored.every((edge) => edge.kind === 'authored')).toBe(true);
    expect(inferred.every((edge) => edge.kind === 'inferred')).toBe(true);
    expect(inferred.length).toBeGreaterThan(0);
  });

  it('never emits a pair as both, so a client cannot double-count or conflate them', () => {
    const { authored, inferred } = assembleEdges(concepts, TARGET_MEAN_DEGREE);

    // a-b is asserted by a source document *and* highly similar. It stays authored: an
    // assertion is the stronger claim, and reporting it twice would inflate the density.
    expect(authored.map(key)).toContain('a|b');
    expect(inferred.map(key)).not.toContain('a|b');
  });

  it('gives authored edges strength 1 and inferred edges their measured similarity', () => {
    const { authored, inferred } = assembleEdges(concepts, TARGET_MEAN_DEGREE);

    expect(authored.every((edge) => edge.strength === 1)).toBe(true);
    expect(inferred.every((edge) => edge.strength < 1 && edge.strength > -1)).toBe(true);
  });
});

describe('the inferred cut targets a mean degree, not a similarity value (FR-013)', () => {
  // Six near-orthogonal directions, each leaning slightly towards a shared one, so that
  // every pairwise similarity lands in a narrow band below 0.44 -- the same shape as the
  // real corpus, shifted down. A hardcoded 0.44 would return an empty graph here; a
  // degree target still reaches its density.
  const spread: ConceptForEdges[] = [0.14, 0.15, 0.16, 0.17, 0.18, 0.19].map((lean, index) => ({
    conceptId: String.fromCharCode(97 + index),
    related: [],
    embedding: Array.from({ length: 6 }, (_, axis) => (axis === index ? 1 + lean : lean)),
    hasCorpus: true,
  }));

  it('reaches the target even when every similarity is below the value measured today', () => {
    const sims = spread.flatMap((x, i) =>
      spread.slice(i + 1).map((y) => cosineSimilarity(x.embedding!, y.embedding!)),
    );
    expect(Math.max(...sims)).toBeLessThan(0.44);

    const { inferred, inferredCut } = assembleEdges(spread, 4);

    // 6 concepts at a target mean degree of 4 is 12 edges: round(4 * 6 / 2).
    expect(inferred).toHaveLength(12);
    expect(inferredCut).toBeLessThan(0.44);
  });

  it('counts authored edges towards the target rather than adding on top of them', () => {
    const withAuthored = spread.map((concept, index) =>
      index === 0 ? { ...concept, related: ['b', 'c', 'd'] } : concept,
    );

    const { authored, inferred } = assembleEdges(withAuthored, 4);

    expect(authored).toHaveLength(3);
    expect(authored.length + inferred.length).toBe(12);
  });

  it('leaves no concept unconnected even after the target is reached', () => {
    // a-d are a tight cluster; e points nearly orthogonally away from all of them. The
    // 5 edges the target allows all fall inside the cluster, so e is only connected
    // because FR-013 requires it -- one extra edge, its own best candidate.
    const cluster: ConceptForEdges[] = [
      onCircle('a', 0),
      onCircle('b', 0.1),
      onCircle('c', 0.2),
      onCircle('d', 0.3),
      onCircle('e', 1.6),
    ];

    const { authored, inferred } = assembleEdges(cluster, 2);

    const degree = new Map(cluster.map((concept) => [concept.conceptId, 0]));
    for (const edge of [...authored, ...inferred]) {
      degree.set(edge.a, degree.get(edge.a)! + 1);
      degree.set(edge.b, degree.get(edge.b)! + 1);
    }
    expect([...degree.values()].filter((count) => count === 0)).toEqual([]);
    expect(degree.get('e')).toBe(1);
    expect(inferred).toHaveLength(6);
  });

  it('produces the same edges, in the same order, on repeated calls (FR-015)', () => {
    expect(assembleEdges(spread, 4)).toEqual(assembleEdges(spread, 4));
  });
});

describe('against the real 70 concept vectors', () => {
  const prisma = new PrismaClient();
  let all: ConceptForEdges[];

  beforeAll(async () => {
    await prisma.$connect();
    const meta = await prisma.concept.findMany({
      select: { conceptId: true, related: true, hasCorpus: true },
      orderBy: { conceptId: 'asc' },
    });
    const vectors = await prisma.$queryRaw<{ conceptId: string; embedding: string | null }[]>`
      SELECT concept_id AS "conceptId", embedding::text AS embedding FROM concepts
    `;
    const byId = new Map(vectors.map((row) => [row.conceptId, row.embedding]));
    // tests/integration/ingest-corpus creates `test-concept-*` rows and Jest runs suites
    // in parallel, so anything measured against a live count has to leave them out --
    // they carry no vector and would show up here as unconnectable concepts.
    all = meta
      .filter((concept) => !concept.conceptId.startsWith('test-concept-'))
      .map((concept) => ({
        conceptId: concept.conceptId,
        related: concept.related,
        embedding: JSON.parse(byId.get(concept.conceptId) ?? 'null') as number[] | null,
        hasCorpus: concept.hasCorpus,
      }));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reproduces the measured figures for a fixed cut of 0.44', () => {
    // Not how the graph is built -- this is the measurement FR-013 was written against,
    // asserted so that a change in how similarity is computed cannot pass unnoticed.
    expect(all).toHaveLength(70);

    const { authored } = assembleEdges(all, 0);
    expect(authored).toHaveLength(107);

    // Raw cosine, not the rounded `strength` the response carries: the measurement was
    // taken on unrounded values, and at four decimals a pair sitting on 0.43995 crosses
    // the line and turns 239 into 240.
    const authoredKeys = new Set(authored.map(key));
    let dense = 0;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (authoredKeys.has([all[i].conceptId, all[j].conceptId].sort().join('|'))) continue;
        if (cosineSimilarity(all[i].embedding!, all[j].embedding!) >= 0.44) dense++;
      }
    }
    expect(dense).toBe(239);
    expect((2 * (dense + authored.length)) / 70).toBeCloseTo(9.886, 3);
  });

  it('hits the density target on the graph universe, with nothing left unconnected', () => {
    const universe = all.filter((concept) => !NON_CONCEPT_IDS.has(concept.conceptId));
    const { authored, inferred, inferredCut } = assembleEdges(universe, TARGET_MEAN_DEGREE);

    const degree = new Map(universe.map((concept) => [concept.conceptId, 0]));
    for (const edge of [...authored, ...inferred]) {
      degree.set(edge.a, degree.get(edge.a)! + 1);
      degree.set(edge.b, degree.get(edge.b)! + 1);
    }

    // 67 is a consequence of the exclusion rule, not a target: 70 rows minus the three
    // navigation pages.
    expect(universe).toHaveLength(67);
    expect(authored).toHaveLength(103);
    expect(inferred).toHaveLength(232);
    expect((2 * (authored.length + inferred.length)) / universe.length).toBeCloseTo(10, 1);
    expect([...degree.values()].filter((count) => count === 0)).toEqual([]);
    // The cut moved from 0.4384 to 0.40 when grey concepts stopped contributing
    // candidates, which is the whole reason FR-013 targets a degree: the value follows
    // the candidate pool instead of being asserted independently of it.
    expect(inferredCut).toBeGreaterThan(0.38);
    expect(inferredCut).toBeLessThan(0.42);
  });

  it('finds the relationships the source documents never asserted', () => {
    const universe = all.filter((concept) => !NON_CONCEPT_IDS.has(concept.conceptId));
    const { authored, inferred } = assembleEdges(universe, TARGET_MEAN_DEGREE);
    const authoredKeys = new Set(authored.map(key));

    for (const pair of ['big-compute|big-data', 'gateway-offloading|gateway-routing']) {
      expect(authoredKeys.has(pair)).toBe(false);
      expect(inferred.map(key)).toContain(pair);
    }
  });

  it('infers no edge from a concept with no material, but keeps its authored ones', () => {
    // Grey vectors come from a name and its terms with no definition text, so short
    // generic nouns embed near one another because they are short generic nouns. Before
    // this rule 69 of 240 inferred edges joined two grey concepts -- 28.7% against a
    // random expectation of 8.1% -- and five of the eight highest-degree nodes were grey,
    // which put the densest region of the map exactly where there is nothing to open.
    const universe = all.filter((concept) => !NON_CONCEPT_IDS.has(concept.conceptId));
    const grey = new Set(
      universe.filter((concept) => !concept.hasCorpus).map((concept) => concept.conceptId),
    );
    const { authored, inferred } = assembleEdges(universe, TARGET_MEAN_DEGREE);

    expect(grey.size).toBeGreaterThan(0);
    expect(inferred.filter((edge) => grey.has(edge.a) || grey.has(edge.b))).toEqual([]);

    // Kept, not dropped: an authored edge was written by a document author and is real,
    // and a grey node exists to show that something is known and unmaterialised.
    const greyAuthored = authored.filter((edge) => grey.has(edge.a) || grey.has(edge.b));
    expect(greyAuthored.length).toBeGreaterThan(0);
    expect(new Set(greyAuthored.flatMap((edge) => [edge.a, edge.b])).size).toBeGreaterThan(
      grey.size,
    );

    const degreeOf = (id: string) =>
      [...authored, ...inferred].filter((edge) => edge.a === id || edge.b === id).length;
    for (const id of grey) expect(degreeOf(id)).toBeGreaterThan(0);
  });

  it('drops the navigation pages the corpus admitted as concepts (FR-023)', () => {
    // `index`, `overview` and `patterns` are Azure Architecture Center navigation pages:
    // admitted through a `related` edge, no material, no `related` list of their own.
    // `index` is 0.71 similar to `index-table` -- the strongest pair in the corpus and
    // entirely meaningless -- which is what the similarity of a page title to a concept
    // name is worth.
    const vectorOf = (id: string) => all.find((concept) => concept.conceptId === id)!.embedding!;
    expect(cosineSimilarity(vectorOf('index'), vectorOf('index-table'))).toBeGreaterThan(0.7);

    expect([...NON_CONCEPT_IDS].sort()).toEqual(['index', 'overview', 'patterns']);
    for (const excluded of NON_CONCEPT_IDS) {
      expect(all.find((concept) => concept.conceptId === excluded)?.hasCorpus).toBe(false);
    }

    const universe = all.filter((concept) => !NON_CONCEPT_IDS.has(concept.conceptId));
    const { authored, inferred } = assembleEdges(universe, TARGET_MEAN_DEGREE);
    const endpoints = new Set([...authored, ...inferred].flatMap((edge) => [edge.a, edge.b]));
    for (const excluded of NON_CONCEPT_IDS) expect(endpoints.has(excluded)).toBe(false);
  });
});
