# Phase 0 Research: JD Extraction NestJS Integration

## 1. HTTP client for calling the agent orchestration service

**Decision**: Use Node's built-in `fetch` (available since Node 18, and this project
requires Node >=20 per `package.json` `engines`), wrapped in a small injectable NestJS
service (`AgentOrchestrationClient`), rather than adding `@nestjs/axios` + `axios`.

**Rationale**: This feature needs exactly one outbound call type (`POST` with a JSON
body, JSON response, a timeout). Native `fetch` covers this with zero new dependencies.
`@nestjs/axios`/`axios` is a common NestJS pairing, but constitution Principle IV
requires discussion before adding a library outside the locked stack, and nothing here
needs axios's extra surface (interceptors, request/response transformation pipelines) —
introducing it would repeat the same mistake avoided in specs/002's research.md §3
(keeping Zod instead of adding `class-validator` for a similarly narrow need).

**Alternatives considered**:
- `@nestjs/axios` + `axios`: idiomatic NestJS, returns RxJS `Observable`s (which would at
  least reuse the `rxjs` dependency NestJS core already pulls in) — but still adds a new
  third-party HTTP client library for a single simple call, not adopted without a
  separate discussion this narrow need doesn't warrant.
- `got` / `node-fetch`: unnecessary — native `fetch` already covers the need on Node 20+.

## 2. Bounded timeout for the agent-service call

**Decision**: Use `AbortController` with a 30-second timeout on the `fetch` call to the
agent orchestration service. On abort, treat it identically to any other unreachable/
error response — map to the `502` upstream-failure path (spec.md FR-005).

**Rationale**: Without a bound, a hung agent-service connection would hang the whole
request indefinitely, blocking the caller and (eventually) exhausting server resources.
30s is a reasonable default for a synchronous LLM-backed call (matches the kind of
latency a multi-step LangGraph extraction+generation flow could plausibly take) with no
stated performance requirement in spec.md to calibrate against more precisely.

**Alternatives considered**:
- No timeout: rejected — an indefinitely hanging request is a real availability risk,
  especially given the agent service doesn't exist yet and every call will currently
  either connection-refuse immediately or (once built) take a real, LLM-bound amount of
  time.

## 3. Internal contract shape (agent orchestration service)

**Decision**: `POST /extract` on the agent orchestration service, request `{ "text":
string }`, response either `{ "sufficient": true, "extraction": {...}, "directions":
[...] }` or `{ "sufficient": false, "reason": string }`. Full shape in
contracts/agent-orchestration.yaml.

**Rationale**: This mirrors the LangGraph state-graph design already agreed in
specs/001-jd-training-directions/research.md §4 (`extractJdStructure` → conditional edge
on `sufficient` → `generateCandidateDirections`) — that design isn't being reopened, only
relocated across a network boundary. A single synchronous call keeps the NestJS side
simple (no polling/webhook complexity) and matches this feature's own Independent Test
(a single JD submission produces a single response).

**Alternatives considered**:
- Two separate calls (extract, then generate directions): would let the NestJS side
  short-circuit on `sufficient: false` without a second round trip, but the original
  design already made this exact tradeoff at the LangGraph-node level and chose to keep
  extraction and generation as one logical unit from the caller's perspective — no new
  information favors reopening that here.
- Async/webhook pattern (submit, poll or get called back): unnecessary complexity for a
  request that's expected to resolve within the timeout window; the public contract
  (spec.md FR-001, FR-008) is already synchronous request/response and shouldn't leak an
  async internal implementation detail back to the caller.

## 4. Testing strategy given the agent service doesn't exist yet

**Decision**: `AgentOrchestrationClient`'s `fetch` call is mocked in all automated tests
(unit and the contract test for `POST /jd-submissions`), consistent with this project's
existing convention (specs/002: DB connection mocked in automated tests, real
verification done manually). A dedicated unit test for `AgentOrchestrationClient` itself
covers the timeout/network-error mapping to make sure that logic is real and tested, not
just the happy path.

**Rationale**: There's no live agent orchestration service to hit, and even once one
exists, hitting a real LLM-backed service in unit tests would reintroduce exactly the
flakiness/cost/non-determinism constitution Principle II already rules out for LangGraph
node tests — the same reasoning applies one layer up, to whatever calls into that
service.

**Alternatives considered**:
- Skipping automated tests for the failure paths since "the service doesn't exist
  anyway": rejected — the failure-path behavior (FR-005, Acceptance Scenario 3) is real,
  permanent product behavior (it must also work correctly *after* the service exists and
  has a bad day), not a temporary workaround, so it needs real test coverage regardless
  of current deployment status.

## 5. Real bug found during quickstart verification (T007): `tsx` doesn't emit decorator metadata

**Finding**: All 17 automated tests passed, but the first manual `quickstart.md` run
against the real dev server returned `500` instead of `502` on the upstream-failure
path. `JdSubmissionsController`'s injected `JdSubmissionsService` was `undefined` at
request time. Root cause: `tsx` (specs/002's chosen dev runner, research.md §1 there)
runs on esbuild, which never implements TypeScript's `emitDecoratorMetadata` — a
deliberate esbuild scope limitation, not something any tsconfig flag can fix. NestJS's
type-based DI had no metadata to resolve `JdSubmissionsService` against, and silently
injected `undefined` rather than failing loudly at startup. `ts-jest` (used by every
automated test) transpiles with the real TypeScript compiler and emits this metadata
correctly, which is why the entire test suite — including the `AppModule`-level contract
test — passed regardless. This bug traces back to specs/002, which never happened to
exercise a class with a real constructor-injected dependency (`HealthController` and
`PrismaService` both take zero).

**Fix**: `npm run dev` now runs `node --watch --import ./scripts/register-ts-node.mjs
src/main.ts` — `ts-node`'s ESM loader (real `tsc`-backed), registered via Node's
non-deprecated `register()` API rather than the deprecated `--experimental-loader` flag.
`tsx` removed from `package.json` entirely. Re-verified against the real dev server:
correct status codes on all paths, zero rows persisted on upstream failure, and
`node --watch`'s restart-on-change behavior confirmed working.

**Why this belongs in research.md and not just a bug-fix commit**: it's a real design
decision correction (specs/002 research.md §1's `tsx` choice, now marked superseded
there) discovered specifically *because* this feature was the first to genuinely exercise
NestJS dependency injection — worth recording as a decision, not just a diff. Full
writeup in the Obsidian vault: `jobpilot-nestjs-esm-tooling-pitfalls.md`.
