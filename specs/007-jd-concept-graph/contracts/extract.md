# Contract: `POST /extract` (reshaped)

**Feature**: [../spec.md](../spec.md) | **Requirements**: FR-001 to FR-003, FR-022 | **Date**: 2026-08-21

The existing endpoint keeps its path and changes its meaning. It previously returned a role,
tech stack, seniority and a list of candidate training directions, behind a sufficiency gate that
could reject a whole submission. It now returns technical items and nothing else.

`POST /embed`, added in SCRUM-44, is unchanged and reused for phrases the exact tier misses.

## Why the shape changes rather than a new endpoint being added

The old response is not a subset of the new one and has no consumer after this feature. Keeping
both would leave a reachable path to the removed pipeline's behaviour, which FR-022 forbids, and
would leave `ExtractSufficient` / `ExtractInsufficient` alive as the shape a future caller might
reasonably reach for.

## Request

```json
{ "text": "We are recruiting an AI Engineer who ..." }
```

Unchanged.

## Response `200`

```json
{
  "items": [
    { "surface": "Queue-Based Load Leveling",
      "evidence": ["Design and operate Queue-Based Load Leveling between services"] },
    { "surface": "message broker",
      "evidence": ["experience with a message broker", "message broker configuration"] }
  ]
}
```

| Field | Rules |
|---|---|
| `items` | 0 to 200. An empty list is valid and means the posting had no technical content |
| `items[].surface` | The phrase as the posting wrote it. Not normalised, not expanded, not corrected — normalisation belongs to the caller, which owns the single `normalizeTerm` implementation |
| `items[].evidence` | 1 to 10 spans, each a substring of the submitted text |

**The service does not resolve, score, classify or rank.** It does not know what a concept is and
has no database access — DESIGN.md §4.1. It reports what the posting mentions; deciding what
those mentions refer to is the caller's job.

**No sufficiency verdict.** There is no `sufficient` field and no rejection branch. A posting with
nothing technical yields `{"items": []}`. This is the contract-level expression of FR-004: absence
is reported per item, never as a whole-submission judgment.

**`surface` is returned unnormalised on purpose.** Normalising here would put a second
implementation of `normalizeTerm` on the Python side, and two implementations that drift produce
lookups that silently return nothing — the failure SCRUM-44's single-implementation rule exists to
prevent.

## Validation

Pydantic on the Python side, Zod on the TypeScript side, per Constitution Principle I. The Zod
schema replaces `src/agent-orchestration/schemas/extract-response.schema.ts` rather than extending
it; the union of `ExtractSufficient` and `ExtractInsufficient` is deleted.

The response schema must assert that every `evidence` span is a substring of the submitted text.
A model that paraphrases evidence instead of quoting it should fail at the boundary, not become a
stored `evidence` value that no longer appears in the posting.

## Graph topology

```
before   START -> extract_jd_structure -> (sufficient?) -> generate_candidate_directions -> END
                                                        -> reject_input                  -> END

after    START -> extract_items -> END
```

The conditional edge and both downstream nodes go. `_route_on_sufficient`, `make_extract_node`,
`make_generate_directions_node` and `reject_input` are replaced by a single
`make_extract_items_node`.

A single-node graph is not an argument for removing LangGraph: the retry loop in DESIGN.md §6 is
P1 and lands on this graph, and the state-machine wiring is what it attaches to.

## Errors

| Status | When |
|---|---|
| `422` | Request fails validation |
| `502` | The provider call failed or returned output that does not validate, surfaced as `AgentLLMError` — the existing behaviour |

No retry inside this feature. The workflow retry loop is P1 and out of scope.

## Test obligations

| Test | Location | Asserts |
|---|---|---|
| Endpoint contract | `agent-service/tests/contract/test_extract.py` | Item shape, empty-list case, `422`, `502`. Provider mocked |
| Node | `agent-service/tests/unit/test_nodes.py` | Extraction node in isolation, provider mocked. Existing direction-node tests deleted with the node |
| Graph | `agent-service/tests/unit/test_graph.py` | One node, no conditional edge, no reject path |
| Response schema | `tests/unit/agent-orchestration/extract-response.schema.test.ts` | Rejects a paraphrased evidence span, rejects the old sufficient/insufficient shape, accepts a valid payload |
| Client | `tests/contract/extract.contract.test.ts` | `fetch` stubbed: valid payload, malformed payload, unreachable service |

No test calls a provider.
