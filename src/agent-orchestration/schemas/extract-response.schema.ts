import { z } from 'zod';

// Bounds from specs/007-jd-concept-graph/contracts/extract.md. They are the contract's
// own guard against an unbounded response, not provider limits.
const MAX_ITEMS = 200;
const MAX_EVIDENCE_SPANS = 10;

const extractedItemSchema = z.object({
  // The phrase as the posting wrote it. Deliberately NOT normalized here: normalizeTerm
  // has exactly one implementation (src/corpus/normalize-term.ts) and it runs at resolve
  // time, on this side of the wire. See docs/DECISIONS.md, 2026-08-10 concept_terms.
  surface: z.string().min(1),
  evidence: z.array(z.string()).min(1).max(MAX_EVIDENCE_SPANS),
});

/**
 * The /extract response schema, bound to the text that was submitted.
 *
 * It is a factory rather than a constant because the one assertion that matters most
 * cannot be made without the source text: every evidence span must be a substring of the
 * posting it claims to come from. A model that paraphrases instead of quoting has to fail
 * at this boundary -- otherwise the paraphrase is stored as `evidence` and can never be
 * located in the posting again, which is the failure mode hard constraint 1 exists to
 * prevent.
 *
 * The old union of ExtractSufficient and ExtractInsufficient is deleted rather than kept
 * alongside this: leaving it would leave a reachable path to the removed pipeline's
 * whole-submission verdict (FR-020, FR-022).
 */
export function buildExtractResponseSchema(submittedText: string) {
  return z.object({
    items: z
      .array(extractedItemSchema)
      .max(MAX_ITEMS)
      .superRefine((items, ctx) => {
        items.forEach((item, index) => {
          item.evidence.forEach((span, spanIndex) => {
            if (!submittedText.includes(span)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [index, 'evidence', spanIndex],
                message: `evidence span for "${item.surface}" is not a substring of the submitted text`,
              });
            }
          });
        });
      }),
  });
}

export type ExtractResponse = z.infer<ReturnType<typeof buildExtractResponseSchema>>;
export type ExtractedItem = z.infer<typeof extractedItemSchema>;
