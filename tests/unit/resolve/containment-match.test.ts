import {
  buildContainmentIndex,
  loosePhrase,
  matchByContainment,
  MIN_CONTAINMENT_TERM_CHARS,
} from '../../../src/resolve/containment-match.js';

/**
 * The containment pass: what tier 1 does after exact equality misses.
 *
 * Deterministic, no provider call, no threshold. The rule under test is a word-boundary
 * containment of a registered term inside the posting's phrase, and -- more importantly
 * than the hits -- the four guards that keep it from inventing a resolution: a minimum
 * term length, the longest match winning, a phrase naming two unrelated concepts staying
 * unresolved, and navigation pages never being a match at all.
 *
 * Containment cannot be overridden downstream: it writes a concept id into a row that
 * everything after it reads as fact. So every case where the right answer is arguable is
 * asserted to be `null`.
 */

const TERMS = [
  { displayTerm: 'ambassador', conceptId: 'ambassador' },
  { displayTerm: 'compensating-transaction', conceptId: 'compensating-transaction' },
  { displayTerm: 'event-driven', conceptId: 'event-driven' },
  { displayTerm: 'microservices', conceptId: 'microservices' },
  { displayTerm: 'publisher-subscriber', conceptId: 'publisher-subscriber' },
  { displayTerm: 'api-design', conceptId: 'api-design' },
  { displayTerm: 'retry', conceptId: 'retry' },
  { displayTerm: 'Retry pattern', conceptId: 'retry' },
  { displayTerm: 'strangler-fig', conceptId: 'strangler-fig' },
  { displayTerm: 'throttling', conceptId: 'throttling' },
  { displayTerm: 'rate-limiting', conceptId: 'rate-limiting' },
  { displayTerm: 'bulkhead', conceptId: 'bulkhead' },
  { displayTerm: 'sidecar', conceptId: 'sidecar' },
  // The three navigation pages the corpus admitted through `related` edges. They are not
  // concepts, and they are the reason a containment pass needs an exclusion list.
  { displayTerm: 'patterns', conceptId: 'patterns' },
  { displayTerm: 'index', conceptId: 'index' },
  { displayTerm: 'overview', conceptId: 'overview' },
];

// The exclusion set the resolver passes in production. Kept here because half of what
// the guards below assert only holds with it applied.
const index = buildContainmentIndex(TERMS, new Set(['patterns', 'index', 'overview']));

const match = (surface: string) => matchByContainment(surface, index);

describe('loosePhrase', () => {
  it('keeps word boundaries where normalizeTerm strips them', () => {
    // normalizeTerm removes every non-alphanumeric, which is right for exact lookup and
    // wrong for containment: on the stripped form `api` is inside `rapid`. The
    // containment pass therefore works on a form that still has spaces in it.
    expect(loosePhrase('Event-Driven Flows')).toBe('event driven flows');
    expect(loosePhrase('  REST  API   design ')).toBe('rest api design');
    expect(loosePhrase('CI/CD')).toBe('ci cd');
  });
});

describe('matchByContainment: the eight phrases measured on a real posting', () => {
  // Every one of these was unresolved under exact equality alone and literally contains a
  // registered concept name. They are the reason this pass exists, so they are asserted
  // individually rather than as a set.
  const cases: [string, string][] = [
    ['ambassador patterns', 'ambassador'],
    ['compensating transaction handling', 'compensating-transaction'],
    ['event-driven flows', 'event-driven'],
    ['microservices estate', 'microservices'],
    ['publisher-subscriber topology', 'publisher-subscriber'],
    ['REST API design', 'api-design'],
    ['retry patterns', 'retry'],
    ['strangler fig approach', 'strangler-fig'],
  ];

  it.each(cases)('resolves %s to %s', (surface, conceptId) => {
    expect(match(surface)?.conceptId).toBe(conceptId);
  });

  it('reports which term produced the hit, so a wrong one can be traced to its phrase', () => {
    expect(match('rate limiting middleware')).toEqual({
      conceptId: 'rate-limiting',
      matchedTerm: 'rate limiting',
    });
  });
});

describe('matchByContainment: word boundaries', () => {
  it('does not match a term inside a longer word', () => {
    // `retry` is in `retrying`, and `index` is in `indexing`, only if the boundary is
    // ignored. Substring containment on the stripped form would take both.
    expect(match('retrying strategy')).toBeNull();
    expect(match('sidecars')).toBeNull();
  });

  it('matches a term that spans several words of the phrase', () => {
    expect(match('a publisher subscriber bus')?.conceptId).toBe('publisher-subscriber');
  });

  it('matches regardless of punctuation and casing in either the phrase or the term', () => {
    expect(match('Event/Driven Architecture')?.conceptId).toBe('event-driven');
  });
});

describe('matchByContainment: the guards', () => {
  it('ignores a term shorter than the minimum, however clearly it is contained', () => {
    const shortIndex = buildContainmentIndex([{ displayTerm: 'api', conceptId: 'api' }]);
    expect('api'.length).toBeLessThan(MIN_CONTAINMENT_TERM_CHARS);
    expect(matchByContainment('api gateway design', shortIndex)).toBeNull();
  });

  it('takes the longest term when one match nests inside another', () => {
    // `rate limiting` and `limiting` would both be contained in the phrase; the more
    // specific one describes the same region of it and is the better claim.
    const nested = buildContainmentIndex([
      { displayTerm: 'rate-limiting', conceptId: 'rate-limiting' },
      { displayTerm: 'limiting', conceptId: 'limiting' },
    ]);
    expect(matchByContainment('adaptive rate limiting', nested)?.conceptId).toBe('rate-limiting');
  });

  it('stays unresolved when the phrase names two different concepts side by side', () => {
    // `sidecar and bulkhead` contains both. Neither is inside the other, so the phrase is
    // naming two things and picking the longer one would be a coin toss recorded as fact.
    expect(match('sidecar and bulkhead')).toBeNull();
    expect(match('throttling and rate limiting')).toBeNull();
  });

  it('stays unresolved on a same-length tie', () => {
    const tied = buildContainmentIndex([
      { displayTerm: 'gamma-one', conceptId: 'gamma-one' },
      { displayTerm: 'delta-two', conceptId: 'delta-two' },
    ]);
    expect(matchByContainment('gamma one delta two', tied)).toBeNull();
  });

  it('never matches a navigation page, so `retry patterns` is a retry and not a patterns', () => {
    // `patterns` (8) is longer than `retry` (5): without the exclusion the longest-wins
    // rule would hand the phrase to an Azure table-of-contents page.
    expect(match('retry patterns')?.conceptId).toBe('retry');
    expect(match('cloud design patterns')).toBeNull();
    expect(match('the index page')).toBeNull();
  });

  it('returns null rather than a match when nothing is contained', () => {
    expect(match('Kubernetes')).toBeNull();
    expect(match('Go')).toBeNull();
    expect(match('')).toBeNull();
  });

  it('does not report a phrase that IS a registered term, since exact equality owns that', () => {
    // Not a correctness rule so much as a boundary one: the containment pass runs only
    // after exact equality missed, and a phrase equal to a term never reaches it. If it
    // did, reporting it would make the two paths indistinguishable in the stored row.
    expect(match('throttling')).toBeNull();
    expect(match('Retry Pattern')).toBeNull();
  });
});
