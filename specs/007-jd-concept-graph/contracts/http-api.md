# Contract: public HTTP surface

**Feature**: [../spec.md](../spec.md) | **Requirements**: FR-001 to FR-015, FR-024 to FR-026 | **Date**: 2026-08-21
| **Amended**: 2026-08-22 (feature 010, `010-jd-shaped-graph`)

> **Amendment, 2026-08-22.** Two changes, both recorded in docs/DECISIONS.md. Tier 1 gained
> a containment pass, so `tier` has a fourth value, `containment`, and `summary` a fourth
> count. And the graph endpoint no longer returns every concept: its node set is the
> posting's, in three layers, and it carries the submission's own items. FR-011's "every
> concept, always" is superseded — it was the wrong map, for the reasons the layer table
> below records.

Two endpoints on the NestJS service. `POST /jd-submissions` is reshaped — its request is
unchanged but its response no longer describes training directions. `GET /jd-submissions/:id/graph`
is new.

## `POST /jd-submissions`

Submit a job description. Extracts items, resolves each, stores everything, returns the
per-item outcome.

**Request**

```json
{ "text": "We are recruiting an AI Engineer who ..." }
```

| Field | Rules |
|---|---|
| `text` | 1 to 20,000 characters after trimming. Beyond that, rejected with a reason rather than truncated (FR-005) |

**Response `201`**

```json
{
  "submissionId": "9f2c...",
  "items": [
    { "surface": "Queue-Based Load Leveling", "conceptId": "queue-based-load-leveling",
      "tier": "exact", "score": null, "evidence": ["...responsibilities include ..."] },
    { "surface": "retry patterns", "conceptId": "retry",
      "tier": "containment", "score": null, "evidence": ["..."] },
    { "surface": "Kubernetes", "conceptId": null,
      "tier": "unresolved", "score": 0.2841, "evidence": ["..."] }
  ],
  "summary": { "total": 23, "exact": 4, "containment": 6, "similarity": 0, "unresolved": 13 }
}
```

**There is no submission-level rejection for insufficiency.** A posting with no recognisable
technical content returns `201` with every item unresolved, or with no items at all (FR-004).
The old `sufficient: false` shape is gone and must not reappear in another form (FR-022).

`summary` exists so a caller can see coverage without walking the array. High `unresolved` is a
correct and informative outcome, not an error (SC-007).

### Tiers

| `tier` | What it claims |
|---|---|
| `exact` | The normalised phrase **is** a registered term. One indexed lookup |
| `containment` | The phrase **contains** a registered term at word boundaries. Also a table lookup, no vector and no threshold, but a weaker claim than equality — see `src/resolve/containment-match.ts` for the guards that keep it from guessing |
| `similarity` | Reserved. Never produced: the calibration found no separation, so there is no threshold and no similarity tier (FR-016, FR-018) |
| `unresolved` | Nothing in the corpus answers the phrase. `conceptId` is null, and this is the only tier for which it is |

`score` is null for `exact` and for `containment` alike. Neither is a measurement, and a
number would record one that never happened.

**Stored as three values, reported as four.** `ResolutionTier` in Postgres still has
`exact | similarity | unresolved`; a containment hit is stored as `exact` and read back
apart from it by checking whether `normalized` is a registered term, which it is if and
only if exact equality produced the match. Adding an enum value is a schema change and
Principle III routes those through the full planning flow. See
`src/resolve/resolution-tier.ts` and docs/DECISIONS.md for the trade-off this carries.

## `GET /jd-submissions/:id/graph`

The posting's concept map, in one response.

**Response `200`**

```json
{
  "submissionId": "9f2c...",
  "threshold": null,
  "nodes": [
    { "id": "throttling", "conceptId": "throttling", "name": "Throttling",
      "layer": "named-resolved", "hasCorpus": true, "relevance": 1,
      "matchedItems": ["request throttling"], "evidence": [] },
    { "id": "item:kafka", "conceptId": null, "name": "Kafka",
      "layer": "named-unanswered", "hasCorpus": false, "relevance": 1,
      "matchedItems": ["Kafka"], "evidence": ["...backed by Kafka."] },
    { "id": "queue-based-load-leveling", "conceptId": "queue-based-load-leveling",
      "name": "Queue-Based Load Leveling", "layer": "adjacent", "hasCorpus": true,
      "relevance": 0, "matchedItems": [], "evidence": [] }
  ],
  "edges": [
    { "a": "gateway-routing", "b": "gateway-aggregation", "kind": "authored", "strength": 1 },
    { "a": "messaging", "b": "messaging-bridge", "kind": "inferred", "strength": 0.656 }
  ],
  "items": [
    { "surface": "retry patterns", "conceptId": "retry", "tier": "containment",
      "evidence": ["Introducing retry patterns, circuit breaking"] }
  ],
  "stats": {
    "nodes": 53, "authoredEdges": 32, "inferredEdges": 38, "meanDegree": 2.64,
    "inferredCut": 0.4, "namedResolved": 9, "namedUnanswered": 25, "adjacent": 19,
    "offMap": 37, "corpusConcepts": 67
  }
}
```

### The three layers

The node set is the submission's, not the corpus's. Until 2026-08-22 it was every concept,
always, and the measurements that reversed it are in docs/DECISIONS.md: a posting naming
Go, GraphQL, Kafka and Kubernetes showed none of them; a posting the corpus does not cover
produced an identical 67-node map every time; and every map showed Valet Key and Leader
Election whether or not anything mentioned them.

| `layer` | Meaning |
|---|---|
| `named-resolved` | The posting named it and a concept with material answers it |
| `named-unanswered` | The posting named it and nothing answers it. Two sources: a phrase that resolved to no concept (`Go`, `Kafka` — product names, which by the alias rule never become concepts), and a concept the corpus knows of and has no material for. `conceptId` is null for the first and set for the second |
| `adjacent` | One hop from something the posting named: what the role implies but the posting did not spell out. Deliberately subordinate to the other two |

| Field | Rules |
|---|---|
| `id` | The node's identity: a `conceptId`, or `item:<normalized>` for a phrase no concept answered. Edges reference these |
| `conceptId` | Null exactly when the node is a phrase rather than a concept |
| `evidence` | The posting's own wording, present only where there is no concept behind the node. A concept node carries `matchedItems` instead |
| `edges` | Join concepts only, and only where at least one end is a node the posting named. An adjacent-to-adjacent edge is two hops from the submission, and drawing those made the subordinate layer the densest thing on the map. An unmatched phrase therefore has no edges at all — that isolation is the correct reading of it |
| `items` | Every extracted phrase with the pass that resolved it. Present so a graph reopened by id is complete; before this the unresolved list lived only in the `POST` response and was lost on a cold browser |
| `stats.corpusConcepts` / `stats.offMap` | What the corpus holds, and how much of it this map does not draw. Without them a small map reads as a broken corpus rather than as a posting the corpus does not cover |
| `threshold` | Echoed with the baseline that produced it. Null today: the calibration ran and found no separation (FR-019b) |

**Assembled whole, then narrowed.** The edge set is built over the entire corpus before the
posting selects from it, so the density target and the cut it lands on stay properties of
the corpus. Computing them over a five-concept subgraph would make the same pair of
concepts adjacent in one submission and not in another.

**Each named concept contributes at most `ADJACENT_PER_NAMED` neighbours**, authored first
and then by descending similarity. Uncapped, one hop is not a small set: the corpus is
built to a mean degree of ten, and a real posting naming nine concepts pulled in 43 of the
67 — measured against 9 named-resolved and 25 named-unanswered.

**One response, always.** A posting's map measured 21.8 KB against 34.5 KB for the
whole-corpus response it replaces. No pagination, no subgraph parameter, no lazy expansion.

**Identical across repeated requests** for the same submission (FR-015). Everything derives
from stored items and stored vectors; nothing is sampled or time-dependent, and the
adjacency cap walks named concepts in id order so it does not depend on the order the
posting mentioned things in.

`404` if the submission does not exist. There is no partial state — a submission exists
only once its items are stored.

## Errors

| Status | When |
|---|---|
| `400` | `text` missing, empty, or over the length limit |
| `404` | Unknown submission id on the graph endpoint |
| `502` | The inference service failed or returned a malformed result, matching how the existing client surfaces `AgentOrchestrationUnavailableError` |
| `503` | The inference service is unreachable |

Extraction failure fails the request. A submission is not stored with an empty item list on
error, since that is indistinguishable from a posting with no technical content.

## Test obligations

| Test | Asserts |
|---|---|
| `tests/contract/jd-submissions.contract.test.ts` | Request validation, the item shapes, `summary` arithmetic, that a containment hit is reported as its own tier and stored as `exact`, and that no submission-level rejection path exists |
| `tests/contract/concept-graph.contract.test.ts` | Every node in exactly one layer, an unmatched phrase present and edgeless, adjacency one hop and capped, both edge kinds distinguishable, `stats` matches the payload, `404` on unknown id |
| `tests/integration/submit-to-graph.test.ts` | A posting through to its graph against the real corpus, including the `rate limiting` case (it resolves at tier 1 to `rate-limiting`, and `throttling` is nonetheless reachable one edge away), the eight containment phrases, and that a product name is never resolved to something nearby |
