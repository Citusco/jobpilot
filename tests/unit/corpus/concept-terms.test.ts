import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expandConceptTerms, type ExpandedTerm } from '../../../src/corpus/expand-concept-terms.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../../..');
const CANDIDATES_PATH = join(ROOT, 'corpus/_meta/candidates/azure.jsonl');

interface CandidateRow {
  conceptId: string;
  name: string;
  title: string | null;
}

function readCandidates(): CandidateRow[] {
  return readFileSync(CANDIDATES_PATH, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

// Shared by the real-data check and the synthetic-collision tests below, so
// the same detection logic that runs against real data is what a fixture
// actually exercises through its throw branch.
function findCrossConceptCollisions(candidates: CandidateRow[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>(); // term -> set of conceptIds
  for (const c of candidates) {
    const terms = expandConceptTerms({ conceptId: c.conceptId, name: c.name, title: c.title });
    for (const t of terms) {
      const owningConcepts = owners.get(t.term) ?? new Set<string>();
      owningConcepts.add(c.conceptId);
      owners.set(t.term, owningConcepts);
    }
  }
  const collisions = new Map<string, Set<string>>();
  for (const [term, concepts] of owners) {
    if (concepts.size > 1) collisions.set(term, concepts);
  }
  return collisions;
}

// FR-015/FR-016: a normalized phrase must map to at most one concept, and
// this must be checkable with no database (tasks.md T010) -- the primary
// key on concept_terms.term is the backstop, but a test that runs in CI
// unconditionally catches a bad candidate file before anyone runs ingest.
describe('concept_terms uniqueness (corpus/_meta/candidates/azure.jsonl)', () => {
  it('has candidate rows to check against (environment sanity)', () => {
    expect(readCandidates().length).toBeGreaterThan(0);
  });

  it('produces no term claimed by two different concepts', () => {
    const collisions = findCrossConceptCollisions(readCandidates());
    if (collisions.size > 0) {
      const report = [...collisions.entries()]
        .map(([term, concepts]) => `  "${term}" claimed by: ${[...concepts].join(', ')}`)
        .join('\n');
      throw new Error(`${collisions.size} cross-concept term collision(s):\n${report}`);
    }
  });

  it('actually detects a synthetic collision -- the real candidate file has zero, so that check alone never exercises this branch', () => {
    const colliding: CandidateRow[] = [
      { conceptId: 'fixture-a', name: 'Same Name', title: null },
      { conceptId: 'fixture-b', name: 'Same Name', title: null },
    ];
    const collisions = findCrossConceptCollisions(colliding);
    expect(collisions.size).toBeGreaterThan(0);
    expect(collisions.get('samename')).toEqual(new Set(['fixture-a', 'fixture-b']));
  });

  it('reports every independent collision, not only the first', () => {
    const colliding: CandidateRow[] = [
      { conceptId: 'fixture-a', name: 'Alpha Name', title: null },
      { conceptId: 'fixture-b', name: 'Alpha Name', title: null },
      { conceptId: 'fixture-c', name: 'Beta Name', title: null },
      { conceptId: 'fixture-d', name: 'Beta Name', title: null },
    ];
    const collisions = findCrossConceptCollisions(colliding);
    // Each pair collides on more than one normalized term here (the name
    // itself, plus the mechanical "name + pattern" variant, since both
    // concepts in a pair share the same name) -- what matters is that BOTH
    // independent pairs are represented, a superset check rather than an
    // exact key list.
    const keys = [...collisions.keys()];
    expect(keys).toEqual(expect.arrayContaining(['alphaname', 'betaname']));
    expect(collisions.get('alphaname')).toEqual(new Set(['fixture-a', 'fixture-b']));
    expect(collisions.get('betaname')).toEqual(new Set(['fixture-c', 'fixture-d']));
  });

  it('deduplicates within a single concept, keeping the highest-precedence origin: id over name', () => {
    // cqrs: conceptId "cqrs" and name "CQRS" both normalize to "cqrs" --
    // the id-origin entry must win, not name.
    const terms = expandConceptTerms({ conceptId: 'cqrs', name: 'CQRS', title: null });
    const cqrsTerm = terms.find((t) => t.term === 'cqrs');
    expect(cqrsTerm?.termType).toBe('id');
    expect(terms.filter((t) => t.term === 'cqrs')).toHaveLength(1);
  });

  it('deduplicates within a single concept, keeping the highest-precedence origin: name over title', () => {
    // A name that already ends in "pattern" makes the mechanical
    // with-trailing-pattern variant literally equal to name, colliding on
    // the SAME normalized term -- name (precedence 1) must win over that
    // title-typed candidate (precedence 2), not the other way around.
    const terms = expandConceptTerms({ conceptId: 'x', name: 'X Pattern', title: null });
    const collidingTerm = terms.find((t) => t.term === 'xpattern');
    expect(collidingTerm?.termType).toBe('name');
    expect(terms.filter((t) => t.term === 'xpattern')).toHaveLength(1);
  });

  it('every entry retains its original unnormalized form (FR-017)', () => {
    // A deliberately abbreviated id (unlike the real corpus, where id and
    // name almost always normalize identically) so id- and name-origin
    // terms don't collide and both survive to be checked.
    const terms = expandConceptTerms({
      conceptId: 'qbll',
      name: 'Queue-Based Load Leveling',
      title: null,
    });
    const displayTerms = terms.map((t) => t.displayTerm);
    expect(displayTerms).toContain('qbll');
    expect(displayTerms).toContain('Queue-Based Load Leveling');
  });

  it('reports the measured term and concept counts over the real candidate set', () => {
    const candidates = readCandidates();
    const allTerms: ExpandedTerm[] = candidates.flatMap((c) =>
      expandConceptTerms({ conceptId: c.conceptId, name: c.name, title: c.title }),
    );
    console.log(
      `[concept-terms] ${candidates.length} concepts, ${allTerms.length} terms, ` +
        `${(allTerms.length / candidates.length).toFixed(2)} per concept`,
    );
    expect(allTerms.length).toBeGreaterThan(0);
  });
});
