import { extractResponseSchema } from '../../../src/agent-orchestration/schemas/extract-response.schema.js';

describe('extractResponseSchema', () => {
  it('accepts a valid sufficient response', () => {
    const result = extractResponseSchema.safeParse({
      sufficient: true,
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior', seniorityInferred: false },
      directions: [{ name: 'API design', rationale: 'quoted from JD', tags: ['api'], suggestedQuestionCount: 3 }],
    });

    expect(result.success).toBe(true);
  });

  it('accepts a valid insufficient response', () => {
    const result = extractResponseSchema.safeParse({ sufficient: false, reason: 'too short' });

    expect(result.success).toBe(true);
  });

  it('accepts zero directions on a sufficient response', () => {
    const result = extractResponseSchema.safeParse({
      sufficient: true,
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior', seniorityInferred: false },
      directions: [],
    });

    expect(result.success).toBe(true);
  });

  it('rejects a direction with an empty tags array (min 1)', () => {
    const result = extractResponseSchema.safeParse({
      sufficient: true,
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior', seniorityInferred: false },
      directions: [{ name: 'API design', rationale: 'quoted from JD', tags: [], suggestedQuestionCount: 3 }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a direction with a zero suggestedQuestionCount', () => {
    const result = extractResponseSchema.safeParse({
      sufficient: true,
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior', seniorityInferred: false },
      directions: [{ name: 'API design', rationale: 'quoted from JD', tags: ['api'], suggestedQuestionCount: 0 }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a direction with a negative suggestedQuestionCount', () => {
    const result = extractResponseSchema.safeParse({
      sufficient: true,
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior', seniorityInferred: false },
      directions: [{ name: 'API design', rationale: 'quoted from JD', tags: ['api'], suggestedQuestionCount: -1 }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects more than 6 directions', () => {
    const direction = { name: 'API design', rationale: 'quoted from JD', tags: ['api'], suggestedQuestionCount: 3 };
    const result = extractResponseSchema.safeParse({
      sufficient: true,
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior', seniorityInferred: false },
      directions: Array(7).fill(direction),
    });

    expect(result.success).toBe(false);
  });

  it('rejects a sufficient response missing a required extraction field', () => {
    const result = extractResponseSchema.safeParse({
      sufficient: true,
      extraction: { role: 'Backend Engineer', techStack: ['Node.js'], seniority: 'Senior' },
      directions: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an insufficient response missing a reason', () => {
    const result = extractResponseSchema.safeParse({ sufficient: false });

    expect(result.success).toBe(false);
  });

  it('rejects a response matching neither shape', () => {
    const result = extractResponseSchema.safeParse({ unexpected: 'shape' });

    expect(result.success).toBe(false);
  });
});
