// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/generated/**',
      'coverage/**',
      'corpus/.venv/**',
      'corpus/raw/**',
      'agent-service/.venv/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // `public/*.js` ships to the browser as plain JavaScript, so it is outside the
          // TypeScript program the rest of the repo compiles as; it is typed by the
          // hand-written `.d.ts` beside it, which tsconfig does include.
          allowDefaultProject: ['*.js', '*.ts', 'scripts/*.mjs', 'public/*.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
