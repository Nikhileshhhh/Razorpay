import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeTree,
  collectSourceFiles,
  layerOfPath,
  reachableFiles,
} from '../support/boundaries.js';

/**
 * Authoritative import-boundary enforcement (architecture handoff §16).
 *
 *  - domain is a pure kernel: no API/worker/web/config/DB/modules/integrations,
 *    no infrastructure packages, no Node built-ins;
 *  - contracts are browser-safe: same prohibitions as domain, so a contract can
 *    never drag server infrastructure into the web bundle;
 *  - web must not import server-only modules, configuration, infra, or builtins;
 *  - integrations must not depend on module internals or app entry points;
 *  - NO source under src may import the hidden ground-truth labels.
 *
 * This scans real source files and fails on any violation. Deterministic; needs
 * no database or network. ESLint provides a fast secondary guard.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcRoot = join(repoRoot, 'src');

describe('architecture import boundaries', () => {
  it('finds source files to check', () => {
    expect(collectSourceFiles(srcRoot).length).toBeGreaterThan(0);
  });

  it('has no forbidden cross-layer imports', () => {
    const violations = analyzeTree(srcRoot, repoRoot);
    const report = violations.map((v) => `  ${v.file} -> "${v.specifier}": ${v.reason}`).join('\n');
    expect(violations, `Import-boundary violations found:\n${report}`).toEqual([]);
  });

  it('classifies known files into the correct layers', () => {
    expect(layerOfPath(join(srcRoot, 'domain', 'index.ts'), repoRoot)).toBe('domain');
    expect(layerOfPath(join(srcRoot, 'contracts', 'health.ts'), repoRoot)).toBe('contracts');
    expect(layerOfPath(join(srcRoot, 'web', 'main.tsx'), repoRoot)).toBe('web');
    expect(layerOfPath(join(srcRoot, 'config', 'env.ts'), repoRoot)).toBe('config');
    expect(layerOfPath(join(srcRoot, 'integrations', 'razorpay', 'x.ts'), repoRoot)).toBe(
      'integrations',
    );
  });

  it('proves the API process entry point never transitively imports adapter dispatch', () => {
    // Only the worker may invoke adapter dispatch (backend PRD §12.4/§18:
    // "only the worker owns adapter capability"). This is a stronger,
    // whole-graph check than the per-directory layer rules above — it BFS's
    // the REAL, statically-resolvable import graph from the API's own entry
    // point file and proves the adapter dispatch module and the adapter
    // registry it wraps are not anywhere in that reachable set, not merely
    // "not imported by files one hop away".
    const apiEntry = join(srcRoot, 'api', 'server.ts');
    const reachable = reachableFiles(apiEntry);
    const forbidden = [
      join(srcRoot, 'modules', 'actions', 'action-dispatch.ts'),
      join(srcRoot, 'modules', 'actions', 'adapter-registry.ts'),
    ];
    for (const file of forbidden) {
      expect(
        reachable.has(resolve(file)),
        `API entry point ${apiEntry} must never reach ${file}, but it is in the ` +
          `transitively-reachable import graph (${reachable.size} files reachable)`,
      ).toBe(false);
    }
  });
});
