import {
  MAX_JD_TEXT_LENGTH,
  jdSubmissionRequestSchema,
} from '../../../src/jd-submissions/schemas/jd-submission-request.schema.js';

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

  it('rejects a whitespace-only text field', () => {
    const result = jdSubmissionRequestSchema.safeParse({ text: '  \n\t ' });

    expect(result.success).toBe(false);
  });

  it('trims the text it accepts', () => {
    const result = jdSubmissionRequestSchema.safeParse({ text: '  a real JD text  ' });

    expect(result.success && result.data.text).toBe('a real JD text');
  });

  it('accepts text exactly at the length limit', () => {
    const result = jdSubmissionRequestSchema.safeParse({ text: 'a'.repeat(MAX_JD_TEXT_LENGTH) });

    expect(result.success).toBe(true);
  });

  it('rejects text beyond the length limit rather than truncating it', () => {
    // FR-005: exceeded input is rejected with a reason. Truncation would silently drop
    // half a posting and report nothing.
    const result = jdSubmissionRequestSchema.safeParse({
      text: 'a'.repeat(MAX_JD_TEXT_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });

  it('measures the length after trimming, not before', () => {
    const result = jdSubmissionRequestSchema.safeParse({
      text: `  ${'a'.repeat(MAX_JD_TEXT_LENGTH)}  `,
    });

    expect(result.success).toBe(true);
  });
});
