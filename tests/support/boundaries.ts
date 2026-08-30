import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Reusable architectural import-boundary analyzer (architecture handoff §16).
 * Lives under tests/support (not src) so it is never scanned as product code.
 * Used by the authoritative real-source scan AND by the negative fixture tests.
 *
 * SCOPE (accurate limits — do not overstate): this resolves statically
 * analyzable specifiers only — `import`/`export ... from`, `require(...)`, and
 * *literal* `import('...')` dynamic imports. It CANNOT prove that an arbitrary
 * *computed* dynamic import path will never resolve into hidden ground truth.
 * That residual gap is closed for the model/evaluation runtime by an ESLint rule
 * banning non-literal dynamic imports there, and a stronger build/runtime
 * exclusion is a deferred MT-010/MT-012 requirement (labels stay empty until then).
 */

export type Layer =
  | 'domain'
  | 'contracts'
  | 'api'
  | 'worker'
  | 'web'
  | 'config'
  | 'modules'
  | 'integrations'
  | 'db'
  | 'other';

/** Server-only infrastructure/framework packages forbidden in pure layers. */
export const INFRA_PACKAGES = [
  'fastify',
  '@fastify/swagger',
  'pg',
  'pg-boss',
  'drizzle-orm',
  'drizzle-kit',
  'pino',
  'pino-pretty',
  'dotenv',
];

const NODE_BUILTINS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/** Path segment that hidden evaluation labels live under; unreachable from src. */
const HIDDEN_GROUND_TRUTH = 'fixtures/hidden-ground-truth';

export function isInfraPackage(specifier: string): boolean {
  return INFRA_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

export function isNodeBuiltin(specifier: string): boolean {
  if (specifier.startsWith('node:')) return true;
  return NODE_BUILTINS.has(specifier);
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

/** Map an absolute path inside the repo to an architectural layer. */
export function layerOfPath(absPath: string, repoRoot: string): Layer {
  const rel = relative(repoRoot, absPath).replaceAll('\\', '/');
  if (rel === 'src/domain' || rel.startsWith('src/domain/')) return 'domain';
  if (rel.startsWith('src/contracts/')) return 'contracts';
  if (rel.startsWith('src/api/')) return 'api';
  if (rel.startsWith('src/worker/')) return 'worker';
  if (rel.startsWith('src/web/')) return 'web';
  if (rel.startsWith('src/config/')) return 'config';
  if (rel.startsWith('src/modules/')) return 'modules';
  if (rel.startsWith('src/integrations/')) return 'integrations';
  if (rel.startsWith('db/')) return 'db';
  return 'other';
}

export function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_PATTERNS = [
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function extractSpecifiers(code: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

export interface Violation {
  file: string;
  specifier: string;
  reason: string;
}

interface LayerRule {
  forbiddenLayers: Layer[];
  forbidInfra: boolean;
  forbidNodeBuiltins: boolean;
}

const RULES: Partial<Record<Layer, LayerRule>> = {
  // Pure financial kernel: no server, no infra, no node builtins.
  domain: {
    forbiddenLayers: ['api', 'worker', 'web', 'config', 'modules', 'integrations', 'db'],
    forbidInfra: true,
    forbidNodeBuiltins: true,
  },
  // Browser-safe contracts: no server, no infra, no node builtins. May import
  // only other contracts and browser-safe packages (e.g. zod).
  contracts: {
    forbiddenLayers: ['api', 'worker', 'web', 'config', 'modules', 'integrations', 'db'],
    forbidInfra: true,
    forbidNodeBuiltins: true,
  },
  // Browser bundle: no server-only modules/config, no infra, no node builtins.
  web: {
    forbiddenLayers: ['config', 'api', 'worker', 'modules', 'integrations', 'db'],
    forbidInfra: true,
    forbidNodeBuiltins: true,
  },
  // Integrations must not reach into module internals or app entry points.
  integrations: {
    forbiddenLayers: ['modules', 'api', 'web', 'worker'],
    forbidInfra: false,
    forbidNodeBuiltins: false,
  },
};

function targetsHiddenGroundTruth(fromFile: string, specifier: string, repoRoot: string): boolean {
  if (specifier.replaceAll('\\', '/').includes('hidden-ground-truth')) return true;
  if (isRelative(specifier)) {
    const resolved = resolve(dirname(fromFile), specifier).replaceAll('\\', '/');
    const root = resolve(repoRoot, HIDDEN_GROUND_TRUTH).replaceAll('\\', '/');
    if (resolved === root || resolved.startsWith(`${root}/`)) return true;
  }
  return false;
}

/** Analyze a single source file's code for boundary violations. */
export function analyzeCode(fromFile: string, code: string, repoRoot: string): Violation[] {
  const violations: Violation[] = [];
  const fromLayer = layerOfPath(fromFile, repoRoot);
  const relFile = relative(repoRoot, fromFile).replaceAll('\\', '/');

  for (const specifier of extractSpecifiers(code)) {
    // Global rule: NO source under src may import hidden ground truth.
    if (relFile.startsWith('src/') && targetsHiddenGroundTruth(fromFile, specifier, repoRoot)) {
      violations.push({
        file: relFile,
        specifier,
        reason: 'no runtime source may import hidden ground-truth labels',
      });
      continue;
    }

    const rule = RULES[fromLayer];
    if (!rule) continue;

    const isPackage = !isRelative(specifier);
    if (isPackage) {
      if (rule.forbidNodeBuiltins && isNodeBuiltin(specifier)) {
        violations.push({
          file: relFile,
          specifier,
          reason: `${fromLayer} must not import Node built-ins`,
        });
      } else if (rule.forbidInfra && isInfraPackage(specifier)) {
        violations.push({
          file: relFile,
          specifier,
          reason: `${fromLayer} must not import server/infrastructure packages`,
        });
      }
    } else {
      const to = layerOfPath(resolve(dirname(fromFile), specifier), repoRoot);
      if (rule.forbiddenLayers.includes(to)) {
        violations.push({
          file: relFile,
          specifier,
          reason: `${fromLayer} must not import ${to} code`,
        });
      }
    }
  }

  return violations;
}

/** Analyze every source file under a src root. */
export function analyzeTree(srcRoot: string, repoRoot: string): Violation[] {
  const violations: Violation[] = [];
  for (const file of collectSourceFiles(srcRoot)) {
    violations.push(...analyzeCode(file, readFileSync(file, 'utf8'), repoRoot));
  }
  return violations;
}
