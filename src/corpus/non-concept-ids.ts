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
 * `overview` and `patterns` are the same class of page: `addedFrom: related-edge`, no
 * material, and no `related` edges of their own. They were left in at first because
 * excluding them is a corpus admission call and admission is a human decision, not an
 * engineering one (CLAUDE.md hard constraint 7). The user made that call on 2026-08-22.
 *
 * This list is the interim remedy, applied where the graph is derived. The durable fix
 * is an exclusion rule in corpus admission, which is not this feature's work.
 */
export const NON_CONCEPT_IDS: ReadonlySet<string> = new Set(['index', 'overview', 'patterns']);
