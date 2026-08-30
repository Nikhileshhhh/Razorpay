import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeCode } from '../support/boundaries.js';

/**
 * Negative fixture tests: prove the analyzer actually DETECTS violations. We
 * write synthetic source files into a throwaway repo layout and assert each
 * forbidden import is reported. Guards against the scanner silently passing.
 */
describe('architecture boundary violations are detected', () => {
  let repoRoot: string;

  beforeAll(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'moneytrace-boundaries-'));
    mkdirSync(join(repoRoot, 'fixtures', 'hidden-ground-truth'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'fixtures', 'hidden-ground-truth', 'labels.ts'),
      'export const x = 1;\n',
    );
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function analyze(relFile: string, code: string) {
    return analyzeCode(join(repoRoot, relFile), code, repoRoot);
  }

  it('flags a contract importing a Node built-in', () => {
    const v = analyze('src/contracts/bad.ts', `import { readFileSync } from 'node:fs';\n`);
    expect(v.map((x) => x.reason)).toContain('contracts must not import Node built-ins');
  });

  it('flags a contract importing a bare Node built-in (no node: prefix)', () => {
    const v = analyze('src/contracts/bad2.ts', `import { join } from 'path';\n`);
    expect(v.map((x) => x.reason)).toContain('contracts must not import Node built-ins');
  });

  it('flags a contract importing a server infrastructure package', () => {
    const v = analyze('src/contracts/bad3.ts', `import Fastify from 'fastify';\n`);
    expect(v.map((x) => x.reason)).toContain(
      'contracts must not import server/infrastructure packages',
    );
  });

  it('flags a contract importing config code', () => {
    const v = analyze('src/contracts/bad4.ts', `import { loadEnv } from '../config/env.js';\n`);
    expect(v.map((x) => x.reason)).toContain('contracts must not import config code');
  });

  it('flags domain importing an infrastructure package', () => {
    const v = analyze('src/domain/bad.ts', `import PgBoss from 'pg-boss';\n`);
    expect(v.map((x) => x.reason)).toContain(
      'domain must not import server/infrastructure packages',
    );
  });

  it('flags web importing server config', () => {
    const v = analyze('src/web/bad.tsx', `import { loadEnv } from '../config/env.js';\n`);
    expect(v.map((x) => x.reason)).toContain('web must not import config code');
  });

  it('flags integrations importing module internals', () => {
    const v = analyze(
      'src/integrations/razorpay/bad.ts',
      `import { thing } from '../../modules/cases/internal.js';\n`,
    );
    expect(v.map((x) => x.reason)).toContain('integrations must not import modules code');
  });

  it('flags any src file importing hidden ground-truth (relative)', () => {
    const v = analyze(
      'src/modules/cases/bad.ts',
      `import { labels } from '../../../fixtures/hidden-ground-truth/labels.js';\n`,
    );
    expect(v.map((x) => x.reason)).toContain(
      'no runtime source may import hidden ground-truth labels',
    );
  });

  it('flags any src file dynamically importing hidden ground-truth', () => {
    const v = analyze(
      'src/api/bad.ts',
      `export async function leak() { return import('../../fixtures/hidden-ground-truth/labels.js'); }\n`,
    );
    expect(v.map((x) => x.reason)).toContain(
      'no runtime source may import hidden ground-truth labels',
    );
  });

  it('does NOT flag a legitimate contract importing zod or another contract', () => {
    const v = analyze(
      'src/contracts/good.ts',
      `import { z } from 'zod';\nimport { HealthResponse } from './health.js';\n`,
    );
    expect(v).toEqual([]);
  });
});
