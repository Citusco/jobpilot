import { EMBEDDING_DIMENSIONS, embedResponseSchema } from '../../../src/agent-orchestration/schemas/embed-response.schema.js';

function vector(seed = 0.1): number[] {
  return Array(EMBEDDING_DIMENSIONS).fill(seed);
}

describe('embedResponseSchema', () => {
  it('accepts a valid payload', () => {
    const result = embedResponseSchema.safeParse({
      vectors: [vector(0.1), vector(0.2)],
      model: 'text-embedding-3-small',
      dimensions: EMBEDDING_DIMENSIONS,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a wrong-length vector -- the check this schema exists for', () => {
    const result = embedResponseSchema.safeParse({
      vectors: [Array(3072).fill(0.1)], // e.g. text-embedding-3-large's dimension
      model: 'text-embedding-3-large',
      dimensions: EMBEDDING_DIMENSIONS,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a mismatched dimensions field even when vectors happen to be the right length', () => {
    const result = embedResponseSchema.safeParse({
      vectors: [vector()],
      model: 'text-embedding-3-small',
      dimensions: 3072,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty vectors array', () => {
    const result = embedResponseSchema.safeParse({
      vectors: [],
      model: 'text-embedding-3-small',
      dimensions: EMBEDDING_DIMENSIONS,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a missing model field', () => {
    const result = embedResponseSchema.safeParse({
      vectors: [vector()],
      dimensions: EMBEDDING_DIMENSIONS,
    });

    expect(result.success).toBe(false);
  });
});
