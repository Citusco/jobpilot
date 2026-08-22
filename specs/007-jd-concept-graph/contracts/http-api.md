# Contract: public HTTP surface

**Feature**: [../spec.md](../spec.md) | **Requirements**: FR-001 to FR-015, FR-024 to FR-026 | **Date**: 2026-08-21

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
    { "surface": "message broker", "conceptId": "publisher-subscriber",
      "tier": "similarity", "score": 0.5123, "evidence": ["..."] },
    { "surface": "Kubernetes", "conceptId": null,
      "tier": "unresolved", "score": 0.2841, "evidence": ["..."] }
  ],
  "summary": { "total": 23, "exact": 4, "similarity": 6, "unresolved": 13 }
}
```

**There is no submission-level rejection for insufficiency.** A posting with no recognisable
technical content returns `201` with every item unresolved, or with no items at all (FR-004).
The old `sufficient: false` shape is gone and must not reappear in another form (FR-022).

`summary` exists so a caller can see coverage without walking the array. High `unresolved` is a
correct and informative outcome, not an error (SC-007).

## `GET /jd-submissions/:id/graph`

The whole concept graph for a submission, in one response.

**Response `200`**

```json
{
  "submissionId": "9f2c...",
  "threshold": { "value": 0.4400, "baseline": "concept-document", "calibratedAt": "2026-08-21T..." },
  "nodes": [
    { "conceptId": "throttling", "name": "Throttling", "hasCorpus": true,
      "relevance": 0.87, "matchedItems": ["request throttling"] },
    { "conceptId": "caching", "name": "Caching", "hasCorpus": false,
      "relevance": 0, "matchedItems": [] }
  ],
  "edges": [
    { "a": "gateway-routing", "b": "gateway-aggregation", "kind": "authored", "strength": 1 },
    { "a": "messaging", "b": "messaging-bridge", "kind": "inferred", "strength": 0.656 }
  ],
  "stats": { "nodes": 70, "authoredEdges": 107, "inferredEdges": 239, "meanDegree": 9.9 }
}
```

| Field | Rules |
|---|---|
| `nodes` | Every concept, always. Concepts nothing resolved to appear with `relevance: 0` — the client needs the whole map to show what was *not* matched |
| `hasCorpus` | Distinguishes "known but no material" from "never heard of", which simply does not appear |
| `edges[].kind` | `authored` or `inferred`, never merged. A client must be able to show which links a document asserted versus which a model inferred (FR-012) |
| `edges[].strength` | `1` for authored — they have no measured weight; the value is a rendering hint, not a claim. Cosine similarity for inferred |
| `threshold` | Echoed with the baseline that produced it, so a floor derived from concept-document phrasing is never read as a verdict about real-world wording (FR-019b) |
| `stats` | Lets a test assert the density target without recomputing it |

**One response, always.** Measured at 34 KB for the full graph (34,491 bytes, 67 nodes and 335
edges, 2026-08-22), so there is no pagination, no subgraph parameter and no lazy expansion. A
caller that wants a subgraph filters client-side. The 12.4 KB the plan estimated covered node ids
and authored edges only; the extra is the per-node name, corpus flag, relevance and matched-item
list plus `kind` and `strength` on each edge, all of which the contract requires.

**Identical across repeated requests** for the same submission (FR-015). Relevance derives from
stored items and edges from stored vectors; nothing is sampled or time-dependent.

`404` if the submission does not exist. There is no partial state — a submission exists only once
its items are stored.

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
| `tests/contract/jd-submissions.contract.test.ts` | Request validation, the three item shapes, `summary` arithmetic, and that no submission-level rejection path exists |
| `tests/contract/concept-graph.contract.test.ts` | All 70 nodes present, both edge kinds distinguishable, `stats` matches the payload, `404` on unknown id |
| `tests/integration/submit-to-graph.test.ts` | A posting through to its graph against the real corpus, including the `rate limiting` case: it resolves at tier 1 to `rate-limiting`, and `throttling` is nonetheless reachable one edge away |
