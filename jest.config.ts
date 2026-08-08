import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  // Loads .env before any test module. Database-backed tests need DATABASE_URL,
  // and without this they only get it by accident: a test that transitively
  // imports a module with `import 'dotenv/config'` at its top (e.g.
  // scripts/ingest-corpus.ts) picks it up as a side effect, while one that
  // imports only the Prisma client does not.
  setupFiles: ['dotenv/config'],
  roots: ['<rootDir>/tests'],
};

export default config;
