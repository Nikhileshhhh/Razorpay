// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Architectural import-boundary groups. These are a fast, defence-in-depth lint
 * guard; the authoritative, exhaustive enforcement lives in
 * tests/unit/architecture-boundaries.test.ts (+ the negative fixture tests).
 */
const SERVER_ONLY_GLOBS = [
  '**/config/**',
  '**/api/**',
  '**/worker/**',
  '**/modules/**',
  '**/integrations/**',
  '**/db/**',
];

const INFRA_PACKAGES = [
  'fastify',
  '@fastify/swagger',
  'pg',
  'pg-boss',
  'drizzle-orm',
  'drizzle-orm/*',
  'pino',
  'pino-pretty',
  'dotenv',
];

// No runtime source may import the hidden evaluation labels.
const HIDDEN_GROUND_TRUTH_GLOBS = ['**/hidden-ground-truth/**'];

const infraPaths = (message) => INFRA_PACKAGES.map((name) => ({ name, message }));

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-web/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  // domain: pure financial kernel. No API/DB/model/integration/web/config/infra/
  // node-builtin/hidden-truth imports.
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [...SERVER_ONLY_GLOBS, '**/web/**', 'node:*', ...HIDDEN_GROUND_TRUTH_GLOBS],
          paths: infraPaths('domain must remain pure: no infrastructure or framework imports.'),
        },
      ],
    },
  },
  // contracts: browser-safe. No server/config/infra/node-builtin/hidden-truth imports.
  {
    files: ['src/contracts/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [...SERVER_ONLY_GLOBS, '**/web/**', 'node:*', ...HIDDEN_GROUND_TRUTH_GLOBS],
          paths: infraPaths('contracts must stay browser-safe: no server/infra imports.'),
        },
      ],
    },
  },
  // web: browser-only. No server modules, configuration, infra, or node builtins.
  {
    files: ['src/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [...SERVER_ONLY_GLOBS, 'node:*', ...HIDDEN_GROUND_TRUTH_GLOBS],
          paths: infraPaths('web is browser-only: server modules and configuration are forbidden.'),
        },
      ],
    },
  },
  // integrations: must not depend on module internals or app entry points.
  {
    files: ['src/integrations/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/modules/**',
            '**/api/**',
            '**/web/**',
            '**/worker/**',
            ...HIDDEN_GROUND_TRUTH_GLOBS,
          ],
        },
      ],
    },
  },
  // remaining runtime source (api/worker/config/modules): forbid hidden truth.
  {
    files: [
      'src/api/**/*.{ts,tsx}',
      'src/worker/**/*.{ts,tsx}',
      'src/config/**/*.{ts,tsx}',
      'src/modules/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...HIDDEN_GROUND_TRUTH_GLOBS] }],
    },
  },
  // Model / evaluation runtime: forbid NON-LITERAL dynamic imports. The boundary
  // analyzer can only resolve literal import()/require() specifiers; a computed
  // path could otherwise reach hidden ground truth. Banning non-literal dynamic
  // import in this runtime closes that gap before labels exist (finding 5).
  {
    files: ['src/modules/investigation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.type!="Literal"]',
          message:
            'Non-literal dynamic import() is forbidden in the model/evaluation runtime; it defeats static hidden-ground-truth checks.',
        },
      ],
    },
  },
  // Node scripts run under Node with node globals.
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
);
