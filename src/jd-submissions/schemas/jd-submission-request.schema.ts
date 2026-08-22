import { z } from 'zod';

// contracts/http-api.md: 1 to 20,000 characters after trimming. Beyond that the request
// is rejected with a reason rather than truncated (FR-005) -- a silently shortened
// posting whose missing half is never reported is the failure this guards against.
export const MAX_JD_TEXT_LENGTH = 20_000;

export const jdSubmissionRequestSchema = z.object({
  text: z.string().trim().min(1).max(MAX_JD_TEXT_LENGTH),
});

export type JdSubmissionRequest = z.infer<typeof jdSubmissionRequestSchema>;
