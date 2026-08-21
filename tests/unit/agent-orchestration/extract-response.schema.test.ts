import { buildExtractResponseSchema } from '../../../src/agent-orchestration/schemas/extract-response.schema.js';

const JD_TEXT =
  'We are hiring a Backend Engineer. Responsibilities include operating ' +
  'Queue-Based Load Leveling between services and tuning a message broker. ' +
  'Must hold citizenship and be located in Sydney.';

describe('buildExtractResponseSchema', () => {
  it('accepts a payload whose evidence spans are quoted from the submitted text', () => {
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({
      items: [
        {
          surface: 'Queue-Based Load Leveling',
          evidence: ['operating Queue-Based Load Leveling between services'],
        },
        { surface: 'message broker', evidence: ['tuning a message broker'] },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty item list, which is what a posting with no technical content yields', () => {
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({ items: [] });

    expect(result.success).toBe(true);
  });

  it('rejects an evidence span that is paraphrased rather than quoted', () => {
    // The whole point of the check: `content.includes(verbatim)` is the only thing that
    // makes a stored evidence span locatable in the posting it claims to come from. A
    // model that rewrites the sentence must fail at the boundary, not be stored.
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({
      items: [
        { surface: 'message broker', evidence: ['the role involves working with message brokers'] },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a payload where only one span among several is not quoted', () => {
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({
      items: [
        {
          surface: 'message broker',
          evidence: ['tuning a message broker', 'message-broker experience required'],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a span that differs from the source only by case', () => {
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({
      items: [{ surface: 'message broker', evidence: ['Tuning A Message Broker'] }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects the old sufficient shape', () => {
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({
      sufficient: true,
      extraction: {
        role: 'Backend Engineer',
        techStack: ['Node.js'],
        seniority: 'Senior',
        seniorityInferred: false,
      },
      directions: [
        { name: 'API design', rationale: 'quoted from JD', tags: ['api'], suggestedQuestionCount: 3 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects the old insufficient shape, so the sufficiency gate cannot return through the wire', () => {
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({
      sufficient: false,
      reason: 'JD text is too short',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an item with no evidence at all', () => {
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({
      items: [{ surface: 'message broker', evidence: [] }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an item with an empty surface', () => {
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({
      items: [{ surface: '', evidence: ['tuning a message broker'] }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects more than 10 evidence spans on one item', () => {
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({
      items: [
        { surface: 'message broker', evidence: Array(11).fill('tuning a message broker') },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects more than 200 items', () => {
    const item = { surface: 'message broker', evidence: ['tuning a message broker'] };
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({
      items: Array(201).fill(item),
    });

    expect(result.success).toBe(false);
  });

  it('rejects a response matching neither shape', () => {
    const result = buildExtractResponseSchema(JD_TEXT).safeParse({ unexpected: 'shape' });

    expect(result.success).toBe(false);
  });
});
