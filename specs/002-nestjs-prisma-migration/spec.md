# Feature Specification: NestJS + Prisma API Migration

**Feature Branch**: `scrum-38-nestjs-prisma-migration`

**Created**: 2026-08-02

**Status**: Draft

**Input**: User description: "start with NestJS + Prisma API migration"

## Background

Constitution v2.0.0 (Principle IV) redefines the approved technology stack: the backend
is now split into an API & persistence service (Node.js + TypeScript + NestJS + Prisma)
and a separate agent orchestration service (Python + FastAPI + LangGraph), connected by an
explicit interface. This feature covers only the API & persistence side: replacing the
current Fastify + Drizzle foundation (built under SCRUM-6/7/8-11/3) with NestJS + Prisma,
so all future API/persistence work is built on the constitutionally-approved stack instead
of the deprecated one. It does not build new business endpoints and does not touch the
agent orchestration side — that is a separate feature (Python FastAPI agent orchestration
extraction).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start the API service on the approved framework (Priority: P1)

A backend developer runs the local dev workflow and gets a running NestJS application that
responds to requests, replacing the current Fastify application, so that all subsequent
feature work is built on the locked stack from day one.

**Why this priority**: Nothing else in this feature (or any future API feature) can proceed
until there is a working NestJS application to build on. This is the foundation.

**Independent Test**: Run the existing dev command; the service starts and a basic
health-check request returns a successful response.

**Acceptance Scenarios**:

1. **Given** the migrated codebase, **When** a developer runs the local dev workflow,
   **Then** the API service starts without errors and stays running.
2. **Given** the running API service, **When** a health-check request is made, **Then** the
   service returns a successful response confirming it is up.

---

### User Story 2 - Persist existing data entities through the approved ORM (Priority: P2)

A backend developer needs the data entities already defined for this project (job
description submissions and candidate training directions, established in SCRUM-3) to be
queryable and persistable through Prisma instead of Drizzle, with no change to the shape of
the data.

**Why this priority**: The data model is the second foundational piece — future feature
work (ingesting job descriptions, generating training directions) depends on a working,
constitutionally-approved persistence layer with the same entities already agreed on.

**Independent Test**: Apply the new migration to a fresh database and confirm the resulting
tables, columns, types, and constraints match what the current Drizzle migration produces.

**Acceptance Scenarios**:

1. **Given** a fresh database, **When** the new migration is applied, **Then** it creates
   tables for both existing entities with equivalent fields, types, and constraints to the
   current schema.
2. **Given** the new persistence layer, **When** application code reads or writes either
   entity, **Then** the operation succeeds using the same field names and types as before.
3. **Given** the migrated database, **When** the pgvector extension is queried, **Then** it
   is still enabled and available for future vector-store use.

---

### User Story 3 - Keep the quality gate green through the migration (Priority: P3)

A backend developer (or reviewer) needs the existing quality gate — typecheck, lint, test —
to pass on the migrated codebase, with no leftover Fastify or Drizzle code or dependencies,
so the migration is a clean cutover rather than a dual-stack straddle.

**Why this priority**: This is what makes the migration "done" per the project's Definition
of Done, and prevents the old stack from lingering as dead weight or a source of confusion
for the next feature.

**Independent Test**: Run the typecheck, lint, and test commands against the migrated
codebase and confirm they pass; search the codebase and dependency manifest for Fastify/
Drizzle references and confirm none remain.

**Acceptance Scenarios**:

1. **Given** the migrated codebase, **When** the typecheck, lint, and test commands are run,
   **Then** all three pass.
2. **Given** the migrated codebase, **When** the dependency manifest and source tree are
   inspected, **Then** no Fastify or Drizzle packages or code remain.

---

### Edge Cases

- What happens to the SCRUM-3 Drizzle migration history already committed to the
  repository? It is superseded by the new Prisma migration and removed as part of this
  cutover (see Assumptions).
- What happens if a future feature was already depending on the Fastify/Drizzle API
  surface? None exists yet (routes and repositories are unimplemented scaffolding), so
  there is no consumer to break.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a NestJS application, replacing the current Fastify
  application, that starts via the project's existing local dev workflow.
- **FR-002**: The system MUST expose a health-check endpoint confirming the service is
  running.
- **FR-003**: The system MUST define the two existing data entities — job description
  submission and candidate training direction, including their fields, types, defaults, and
  constraints (e.g. status/count checks, the foreign-key relationship between them) — as a
  Prisma schema equivalent to the current Drizzle schema.
- **FR-004**: The system MUST provide a Prisma migration that creates the same database
  tables, columns, and constraints as the current Drizzle migration, verifiable by applying
  it to a fresh database.
- **FR-005**: The system MUST keep the pgvector extension enabled and available on the same
  Postgres instance under the new migration, for future vector-store use.
- **FR-006**: The system MUST remove the Fastify and Drizzle dependencies and code paths
  once the NestJS/Prisma equivalents are in place — no dual-stack code may remain.
- **FR-007**: The system MUST continue to pass the project's typecheck, lint, and test
  commands (same command names as today) against the migrated codebase.
- **FR-008**: The system MUST provide a data-access layer (via Prisma Client) that future
  feature work can depend on for reading and writing the two existing entities.

### Key Entities

- **Job Description Submission**: A submitted job description and its extracted
  attributes (role, tech stack, seniority, whether seniority was inferred, acceptance
  status, rejection reason if any) and submission time. Already defined under SCRUM-3;
  this feature re-expresses it in Prisma without changing its shape.
- **Candidate Training Direction**: A generated training direction linked to one job
  description submission, with a name, rationale, tags, and a suggested question count.
  Already defined under SCRUM-3; this feature re-expresses it in Prisma without changing
  its shape.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can start the local API service and get a successful
  health-check response within 10 seconds of running the dev command.
- **SC-002**: 100% of the previously defined data entities (2 of 2) are represented in the
  new persistence layer with no difference in fields, types, or constraints.
- **SC-003**: The full quality gate (typecheck, lint, test) passes with zero Fastify or
  Drizzle references remaining anywhere in the codebase or dependency manifest.
- **SC-004**: A fresh database can be brought to the current expected schema state using
  only the new migration tooling, with no manual steps.

## Assumptions

- No production or shared dev data exists yet in the SCRUM-3 tables that needs to be
  preserved across the cutover — only the schema definition needs to carry over, not any
  rows. If this assumption is wrong, a data-preserving migration path should be scoped as
  follow-up work before this feature is merged.
- The empty `src/graph`, `src/llm`, `src/schemas`, and `src/types` scaffolding directories
  (unimplemented placeholders from initial project setup) are out of scope for this
  feature — they relate to agent orchestration, which is being extracted to the separate
  Python service in a different feature, not migrated within the API service.
- This feature builds the NestJS + Prisma foundation and health-check only; it does not
  implement the actual job-description-intake or training-direction business endpoints —
  those are future feature work built on top of this foundation.
- The existing npm script names (`dev`, `test`, `typecheck`, `lint`) are kept as-is, with
  their implementation repointed to the new framework/ORM/test runner, so CLAUDE.md's Bash
  commands section stays accurate without further changes.
