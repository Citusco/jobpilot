import { jdSubmissionRequestSchema } from '../../../src/jd-submissions/schemas/jd-submission-request.schema.js';

describe('jdSubmissionRequestSchema', () => {
  it('accepts a non-empty text string', () => {
    const result = jdSubmissionRequestSchema.safeParse({ text: 'a real JD text' });

    expect(result.success).toBe(true);
  });

  it('rejects a missing text field', () => {
    const result = jdSubmissionRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('rejects an empty string text field', () => {
    const result = jdSubmissionRequestSchema.safeParse({ text: '' });

    expect(result.success).toBe(false);
  });
});
