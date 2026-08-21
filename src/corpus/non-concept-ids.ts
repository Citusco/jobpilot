/**
 * Concept ids that are not concepts.
 *
 * The corpus admits a concept whenever another concept's `related` list names it, which
 * is how a documentation set's own navigation pages get in. `index` is one: an Azure
 * Architecture Center table-of-contents page, referenced by `microservices` and
 * `throttling`, carrying no material. Its vector is built from the word "index" alone,
 * which makes it 0.71 similar to `index-table` -- the single strongest pair in the whole
 * corpus, and completely meaningless (spec.md Edge Cases, FR-023).
 *
 * This list is the interim remedy, applied where the graph is derived. The durable fix
 * is an exclusion rule in corpus admission, which is not this feature's US2 work and,
 * more importantly, is a human decision rather than an engineering one (CLAUDE.md hard
 * constraint 7). `index` is listed here because the specification already made that call
 * in writing; `overview` and `patterns` are the same kind of navigation page and are
 * deliberately NOT listed, because nobody has yet said so.
 */
export const NON_CONCEPT_IDS: ReadonlySet<string> = new Set(['index']);
