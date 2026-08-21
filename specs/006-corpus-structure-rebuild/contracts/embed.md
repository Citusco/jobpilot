# Contract: `POST /embed`

**Feature**: [../spec.md](../spec.md) | **Requirements**: FR-019, FR-025, FR-026 | **Date**: 2026-08-10

The second operation on the interface between the NestJS persistence service and the Python
agent orchestration service, alongside the existing `POST /extract`. It exists because the agent
service is the only component that holds the model-provider credential
(`agent_service/secrets.py`), and giving the TypeScript side its own would mean writing secret
handling a second time and performing the pending access-key-to-role migration twice.

## Boundary

```
NestJS                                  agent-service
  scripts/ingest-corpus.ts    --POST-->   POST /embed
  (later) resolve             --POST-->
                              <--------   { vectors: number[][] }
  writes Concept.embedding
  runs similarity in pgvector
```

**The agent service returns a vector and nothing else.** It does not store one, does not read
one, and does not perform similarity search — DESIGN.md §4.1 gives persistence and retrieval to
the TypeScript side and states that Python does not connect to the database. Producing a vector
is inference; comparing stored vectors is a pgvector query and stays where the data is (FR-026).

## Request

```json
{
  "texts": [
    "Throttling\nalso known as: request throttling, api throttling\nLimit the resources that an application instance, an individual tenant, or an entire service can consume.",
    "Rate Limiting\nalso known as: client-side rate limiting\nControl the rate at which your application sends requests to a service..."
  ]
}
```

| Field | Type | Rules |
|---|---|---|
| `texts` | `string[]` | 1–256 items. Each non-empty after trimming, each at most 8,000 characters |

Batched rather than one call per concept: the corpus build needs about 70 vectors and one
round-trip is preferable to seventy. The 256 ceiling is a guard against an unbounded request, not
a provider limit.

**The caller assembles the text.** The agent service does not know what a concept is and does not
reach into the database to find out — that would cross the boundary the split exists to draw. For
this feature the caller composes name, terms and the opening of the definition; that composition
is ingest's concern and the composed string is never persisted (FR-020).

## Response

```json
{
  "vectors": [[0.0123, -0.0456, ...], [0.0789, -0.0234, ...]],
  "model": "text-embedding-3-small",
  "dimensions": 1536
}
```

| Field | Type | Rules |
|---|---|---|
| `vectors` | `number[][]` | Same length as `texts`, same order. Each inner array exactly `dimensions` long |
| `model` | `string` | The model actually used, so a silent configuration drift is visible in logs |
| `dimensions` | `number` | Must equal 1536 |

**Order is the contract.** Results correspond positionally to the input; there is no id in either
direction. A caller that needs to associate vectors with concepts keeps its own array order.

## Validation

Both sides validate, as Constitution Principle I requires — Pydantic at the Python boundary, Zod
at the TypeScript one.

**The Zod schema MUST assert vector length, not merely that the value is an array of numbers.**
If the configured model changes and returns 3,072 values, an unchecked response fails later at a
`vector(1536)` column, with an error that points at the database rather than at the cause. The
length check turns that into a boundary failure naming the model.

```ts
// src/agent-orchestration/schemas/embed-response.schema.ts
export const EMBEDDING_DIMENSIONS = 1536;

export const embedResponseSchema = z.object({
  vectors: z.array(z.array(z.number()).length(EMBEDDING_DIMENSIONS)).min(1),
  model: z.string().min(1),
  dimensions: z.literal(EMBEDDING_DIMENSIONS),
});
```

The caller additionally checks that `vectors.length === texts.length`, which the schema cannot
express on its own.

## Errors

| Status | When | Caller behaviour |
|---|---|---|
| `422` | Request fails validation | A bug in the caller; fail the build |
| `502` | The provider call failed or returned a malformed result | Fail the build naming the provider. Matches how `/extract` surfaces `AgentLLMError` |
| `503` | Credentials unavailable | Fail the build naming the missing credential, not the network |
| connection refused | Agent service not running | `AgentOrchestrationUnavailableError`, message naming the service and its URL — the likeliest operator error, since the corpus build is otherwise offline |

Not retried inside this feature. The build is operator-run and short; a failed run is re-run.

## Client

`AgentOrchestrationClient` gains `embed(texts: string[])`, following the shape `extract()`
already established: `AGENT_SERVICE_URL` with a localhost default, an `AbortController` timeout,
`AgentOrchestrationUnavailableError` for transport and validation failures, and `safeParse`
before returning. The timeout is longer than `extract`'s 30s — a 70-item batch is a single
provider call but a larger one — and is set at 60s.

## Test obligations

| Test | Location | Asserts |
|---|---|---|
| Endpoint contract | `agent-service/tests/contract/test_embed.py` | Shape in and out, `422` on invalid input, `502` on provider failure. Provider mocked |
| Provider wrapper | `agent-service/tests/unit/test_embeddings.py` | Batching and error translation. Provider mocked; no network |
| Response schema | `tests/unit/agent-orchestration/embed-response.schema.test.ts` | Rejects a wrong-length vector, rejects a mismatched `dimensions`, accepts a valid payload |
| Client | `tests/contract/embed.contract.test.ts` | `fetch` stubbed: length mismatch between request and response rejected, non-2xx mapped to the error type, connection refused named as the service |

No test calls a provider — Constitution Principle II's rule for graph nodes, applied here too.

## Not in this contract

- Embedding chunks. `DocChunk.embedding` exists and stays empty; the trigger and preconditions
  for filling it are recorded in `docs/DECISIONS.md`.
- Similarity search of any kind. That is a pgvector query on the persistence side.
- Caching. At ~70 vectors per build there is nothing to amortise.
