import { z } from 'zod';

export const jdSubmissionRequestSchema = z.object({
  text: z.string().min(1),
});

export type JdSubmissionRequest = z.infer<typeof jdSubmissionRequestSchema>;
