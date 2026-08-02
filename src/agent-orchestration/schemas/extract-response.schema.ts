import { z } from 'zod';

const extractSufficientSchema = z.object({
  sufficient: z.literal(true),
  extraction: z.object({
    role: z.string(),
    techStack: z.array(z.string()),
    seniority: z.string(),
    seniorityInferred: z.boolean(),
  }),
  directions: z
    .array(
      z.object({
        name: z.string(),
        rationale: z.string(),
        tags: z.array(z.string()).min(1),
        suggestedQuestionCount: z.number().int().positive(),
      }),
    )
    .max(6),
});

const extractInsufficientSchema = z.object({
  sufficient: z.literal(false),
  reason: z.string(),
});

export const extractResponseSchema = z.union([extractSufficientSchema, extractInsufficientSchema]);

export type ExtractResponse = z.infer<typeof extractResponseSchema>;
