import { samplePhrases, type SourceChunk } from '../../../src/calibrate/phrase-sampling.js';

/**
 * FR-017: the phrases used for the matching baseline must not be drawn from the same
 * records resolution matches against, or the measurement is circular.
 *
 * There are two such records, not one. The obvious one is `concept_terms`, which tier 1
 * looks up directly. The less obvious one is the **preamble chunk**: a concept's stored
 * vector is built from its name, its terms, and the opening 500 characters of its
 * preamble (scripts/ingest-corpus.ts, `ingestConceptVectors`). A phrase taken from there
 * would be scored against a vector partly built from that same text. Both are excluded
 * here.
 */
describe('samplePhrases (matching-baseline phrases from a concept\'s own material)', () => {
  const preamble: SourceChunk = {
    chunkId: 'azure:bulkhead:preamble',
    headingPath: ['Bulkhead'],
    content:
      '# Bulkhead pattern\n\nIsolate the elements of an application into pools so that if one element fails, the others continue to function and the system survives.',
  };
  const body: SourceChunk = {
    chunkId: 'azure:bulkhead:context-and-problem',
    headingPath: ['Bulkhead', 'Context and problem'],
    content:
      'A cloud-based application might include multiple services, and each service has one or more consumers of its own. Excessive load or failure in one service affects every consumer of that service at once.',
  };
  const links: SourceChunk = {
    chunkId: 'azure:bulkhead:related-resources',
    headingPath: ['Bulkhead', 'Related resources'],
    content:
      '- [Circuit Breaker pattern](./circuit-breaker.md)\n- [Retry pattern](./retry.yml)\n- [Throttling pattern](./throttling.md)',
  };

  const sample = (chunks: SourceChunk[], mask: string[] = ['Bulkhead']) =>
    samplePhrases({ conceptId: 'bulkhead', mask, chunks }, 3);

  it('never draws a phrase from the preamble chunk the concept vector was built from', () => {
    const phrases = sample([preamble]);

    expect(phrases).toEqual([]);
  });

  it('draws phrases from the concept\'s own body sections', () => {
    const phrases = sample([preamble, body]);

    expect(phrases.length).toBeGreaterThan(0);
    for (const phrase of phrases) {
      expect(body.content).toContain(phrase.split(' ').slice(0, 4).join(' '));
    }
  });

  it('masks the concept\'s own names out of every phrase', () => {
    // Without this the baseline measures whether the string "Bulkhead" embeds near the
    // concept "Bulkhead", which is trivially yes and is the same circularity FR-017
    // names -- the name is exactly what `concept_terms` holds.
    const named: SourceChunk = {
      chunkId: 'azure:bulkhead:problems',
      headingPath: ['Bulkhead', 'Problems and considerations'],
      content:
        'A bulkhead partition should be defined around the business and technical requirements of the application it protects.',
    };

    const phrases = samplePhrases({ conceptId: 'bulkhead', mask: ['Bulkhead'], chunks: [named] }, 3);

    expect(phrases.length).toBeGreaterThan(0);
    for (const phrase of phrases) {
      expect(phrase.toLowerCase()).not.toContain('bulkhead');
    }
  });

  it('skips sections that are mostly links to other concepts', () => {
    // A "Related resources" list is text about *other* concepts sitting under this
    // concept's id. Used as a matching phrase it is a mislabelled positive.
    const phrases = sample([links]);

    expect(phrases).toEqual([]);
  });

  it('drops fenced code blocks rather than embedding YAML as a phrase', () => {
    const withCode: SourceChunk = {
      chunkId: 'azure:bulkhead:example',
      headingPath: ['Bulkhead', 'Example'],
      content:
        'The following configuration creates an isolated container to run a single service with its own resource limits.\n\n```yaml\napiVersion: v1\nkind: Pod\nmetadata:\n  name: drone-management\n```\n',
    };

    const phrases = samplePhrases({ conceptId: 'bulkhead', mask: [], chunks: [withCode] }, 3);

    for (const phrase of phrases) {
      expect(phrase).not.toContain('apiVersion');
      expect(phrase).not.toContain('```');
    }
  });

  it('returns at most the requested number of phrases', () => {
    const phrases = samplePhrases({ conceptId: 'bulkhead', mask: [], chunks: [body] }, 1);

    expect(phrases).toHaveLength(1);
  });

  it('is repeatable: the same chunks yield the same phrases in the same order (FR-019)', () => {
    const first = sample([links, body, preamble]);
    const second = sample([preamble, body, links]);

    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });
});
