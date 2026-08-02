# Phase 0 Research: NestJS + Prisma API Migration

## 1. NestJS under ESM with decorator metadata

> [!IMPORTANT] **Superseded, 2026-08-02 (SCRUM-39)**: The `tsx` decision below turned out
> to be wrong for any class with an actual constructor-injected dependency. `tsx` runs on
> esbuild, which does **not** implement TypeScript's `emitDecoratorMetadata` at all — no
> flag or config fixes this, it's a deliberate esbuild scope limitation. Setting the two
> compiler options was necessary but not sufficient: `tsc --noEmit` stayed green (it
> doesn't care what the runtime transpiler does), and `ts-jest` (which uses real `tsc`)
> masked the gap in every test, so this only surfaced when SCRUM-39 added the project's
> first NestJS classes with real constructor dependencies (`JdSubmissionsController`,
> `JdSubmissionsService`) and DI silently injected `undefined` at runtime — no startup
> error, just a `TypeError` on the first real request. `HealthController`/`PrismaService`
> both happen to take zero constructor-injected parameters, so this feature never
> exercised the broken path. Fixed by switching `npm run dev` to
> `node --watch --import ./scripts/register-ts-node.mjs src/main.ts` (`ts-node`'s ESM
> loader, which uses real `tsc` and correctly emits `design:paramtypes`); `tsx` was
> removed from `package.json` entirely. See
> `jobpilot-nestjs-esm-tooling-pitfalls.md` in the Obsidian vault for the full writeup.

**Decision** (original, now superseded above): Run NestJS as ESM, using `tsx` as the dev
runner (already the project's `npm run dev` tool) with an ESM entry point
(`src/main.ts`), and add `"experimentalDecorators": true` and `"emitDecoratorMetadata":
true` to `tsconfig.json` (neither is currently set). Keep `module`/`moduleResolution` as
`NodeNext` and continue using explicit `.js` extensions on relative imports, matching the
existing convention already visible in `src/db/client.ts` (`from './schema.js'`).

**Rationale**: Constitution Principle V and CLAUDE.md both mandate ES modules with no
CommonJS across the TypeScript service — this predates the stack pivot and isn't up for
reconsideration here. NestJS's dependency-injection decorators (`@Injectable`,
`@Controller`, etc.) require `emitDecoratorMetadata`/`experimentalDecorators` regardless
of module system; NestJS has supported ESM projects since v10 as long as these compiler
options are set and imports resolve the way `NodeNext` expects. Reusing `tsx` (rather than
introducing `ts-node` or NestJS's own CLI build pipeline) keeps the existing dev workflow
(`npm run dev`) working unchanged.

**Alternatives considered**:
- Switching the project to CommonJS to sidestep any NestJS/ESM friction: rejected —
  violates Principle V outright, and the project has no CommonJS code to reconcile with.
- Using `@nestjs/cli` (`nest build`/`nest start`) as the dev/build tool: works, but adds a
  second, NestJS-specific build pipeline alongside the project's existing `tsc`/`tsx`
  tooling for no benefit at this scale (one module, one controller); revisit only if the
  service grows enough to need CLI-generated scaffolding regularly.

## 2. HTTP adapter: Express, not Fastify

**Decision**: Use `@nestjs/platform-express` as NestJS's HTTP adapter.

**Rationale**: FR-006 requires zero Fastify dependencies remaining anywhere in the
dependency tree once this migration is done. `@nestjs/platform-fastify` still pulls in
the `fastify` package as a transitive dependency — using it would reintroduce the exact
thing this migration is meant to remove, even though the application code would no longer
touch the Fastify API directly. `@nestjs/platform-express` has no such conflict.

**Alternatives considered**:
- `@nestjs/platform-fastify`: commonly recommended for raw throughput, but rejected here
  specifically because it fails FR-006 (Fastify would still be in `package.json` /
  `node_modules`, just wrapped).

## 3. Request/response validation: keep Zod, don't add class-validator

**Decision**: Continue using `zod` (already a project dependency) for any request/response
shape validation this feature needs (the health-check response), rather than adding
`class-validator` + `class-transformer`, which is NestJS's more commonly documented
pairing.

**Rationale**: Constitution Principle IV requires discussion before introducing a new
library, and CLAUDE.md already names Zod as the project's runtime-validation tool. Adding
a second validation library for the same purpose would be exactly the kind of undiscussed,
silent dependency addition Principle IV prohibits, for no capability this feature actually
needs (the health-check response is a single trivial shape).

**Alternatives considered**:
- `class-validator` + `class-transformer`: NestJS's own docs default to this pairing, but
  it duplicates Zod's job and is a new dependency outside the locked stack — not adopted
  without a separate discussion, which this trivial-shape feature doesn't warrant.

## 4. Enabling pgvector through Prisma

**Decision**: Enable the `postgresqlExtensions` preview feature in `prisma/schema.prisma`
and declare the `vector` extension there (`extensions = [vector]` on the `datasource`
block), so `prisma migrate dev` generates a migration that runs
`CREATE EXTENSION IF NOT EXISTS vector;` alongside the table DDL.

**Rationale**: pgvector was never actually enabled by the prior Drizzle-based setup (no
`CREATE EXTENSION` statement exists in `src/db/migrations/0000_round_queen_noir.sql`) —
FR-005 is establishing it for the first time, not preserving something that already
existed. Prisma's native extensions declaration keeps that state versioned in
`schema.prisma` next to the models it will eventually support, instead of a hand-written
raw-SQL migration that's easy to lose track of.

**Alternatives considered**:
- A hand-written raw-SQL migration file with `CREATE EXTENSION IF NOT EXISTS vector;`:
  works with any Prisma version, but leaves the extension undeclared in `schema.prisma`
  itself. Fall back to this only if the installed Prisma version doesn't support the
  `postgresqlExtensions` preview feature.

## 5. Supersedes the prior ORM decision

The original `specs/001-jd-training-directions/research.md` (§2) chose Drizzle over
Prisma, reasoning that Drizzle's "thin wrapper" style fit the project's preference for
avoiding unnecessary abstraction. Constitution v2.0.0 (Principle IV) overrides that
decision project-wide as part of the NestJS/Prisma stack pivot — noted here for continuity,
not re-litigated.
