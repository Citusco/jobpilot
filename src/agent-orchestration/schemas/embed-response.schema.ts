import { z } from 'zod';

// specs/006-corpus-structure-rebuild/contracts/embed.md: the schema MUST
// assert vector length, not merely that the value is an array of numbers.
// If the configured model changes and returns 3,072 values, an unchecked
// response fails later at a vector(1536) column with an error that points
// at the database rather than at the cause -- the length check turns that
// into a boundary failure naming the model (Constitution Principle I).
export const EMBEDDING_DIMENSIONS = 1536;

export const embedResponseSchema = z.object({
  vectors: z.array(z.array(z.number()).length(EMBEDDING_DIMENSIONS)).min(1),
  model: z.string().min(1),
  dimensions: z.literal(EMBEDDING_DIMENSIONS),
});

export type EmbedResponse = z.infer<typeof embedResponseSchema>;
