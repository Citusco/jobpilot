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

// FR-015/FR-016: a normalized phrase must map to at most one concept, and
// this must be checkable with no database (tasks.md T010) -- the primary
// key on concept_terms.term is the backstop, but a test that runs in CI
// unconditionally catches a bad candidate file before anyone runs ingest.
describe('concept_terms uniqueness (corpus/_meta/candidates/azure.jsonl)', () => {
  it('has candidate rows to check against (environment sanity)', () => {
    expect(readCandidates().length).toBeGreaterThan(0);
  });

  it('produces no term claimed by two different concepts', () => {
    const candidates = readCandidates();
    const owners = new Map<string, Set<string>>(); // term -> set of conceptIds

    for (const c of candidates) {
      const terms = expandConceptTerms({ conceptId: c.conceptId, name: c.name, title: c.title });
      for (const t of terms) {
        const owningConcepts = owners.get(t.term) ?? new Set<string>();
        owningConcepts.add(c.conceptId);
        owners.set(t.term, owningConcepts);
      }
    }

    const collisions = [...owners.entries()].filter(([, concepts]) => concepts.size > 1);
    if (collisions.length > 0) {
      const report = collisions
        .map(([term, concepts]) => `  "${term}" claimed by: ${[...concepts].join(', ')}`)
        .join('\n');
      throw new Error(`${collisions.length} cross-concept term collision(s):\n${report}`);
    }
  });

  it('deduplicates within a single concept, keeping the highest-precedence origin', () => {
    // cqrs: conceptId "cqrs" and name "CQRS" both normalize to "cqrs" --
    // the id-origin entry must win, not name.
    const terms = expandConceptTerms({ conceptId: 'cqrs', name: 'CQRS', title: null });
    const cqrsTerm = terms.find((t) => t.term === 'cqrs');
    expect(cqrsTerm?.termType).toBe('id');
    expect(terms.filter((t) => t.term === 'cqrs')).toHaveLength(1);
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
