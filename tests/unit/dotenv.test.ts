import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDotenv } from '../../src/config/dotenv.js';

/**
 * Proves the `.env` loader reads values from a file into an isolated target
 * WITHOUT mutating the real process environment (so no secret can leak into the
 * shared env or test output). The end-to-end proof that an executable entry
 * point loads `.env` is scripts/smoke-built-api.mjs.
 */
describe('loadDotenv', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'moneytrace-dotenv-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a non-secret marker from a temporary .env into an isolated object', () => {
    const file = join(dir, '.env');
    writeFileSync(file, 'MONEYTRACE_ENV=demo\nAPI_PORT=4599\n');
    const target: Record<string, string> = {};

    const result = loadDotenv({ path: file, processEnv: target });

    expect(result.error).toBeUndefined();
    expect(target.MONEYTRACE_ENV).toBe('demo');
    expect(target.API_PORT).toBe('4599');
    // The real process environment was not touched.
    expect(process.env.API_PORT).not.toBe('4599');
  });

  it('does not mutate process.env when an isolated target is provided', () => {
    const file = join(dir, '.env');
    writeFileSync(file, 'SYNTHETIC_SOURCE_HMAC_SECRET=should_stay_isolated\n');
    const target: Record<string, string> = {};

    loadDotenv({ path: file, processEnv: target });

    expect(target.SYNTHETIC_SOURCE_HMAC_SECRET).toBe('should_stay_isolated');
    expect(process.env.SYNTHETIC_SOURCE_HMAC_SECRET).toBeUndefined();
  });
});
