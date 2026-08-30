import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Deterministic verification that env files are ignored while the template is
 * allowed (finding 3). Reproduces exactly the two relevant .gitignore rules:
 *   .env*          -> ignore anything starting with `.env`
 *   !.env.example  -> but re-include the committed template
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gitignore = readFileSync(resolve(repoRoot, '.gitignore'), 'utf8');

function isIgnored(filename: string): boolean {
  let ignored = false;
  if (filename.startsWith('.env')) ignored = true; // .env*
  if (filename === '.env.example') ignored = false; // !.env.example
  return ignored;
}

describe('.gitignore environment rules', () => {
  it('declares the .env* ignore and the .env.example negation', () => {
    expect(gitignore).toMatch(/^\.env\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });

  it.each(['.env', '.env.production', '.env.test', '.env.demo', '.env.local', '.env.local.secret'])(
    'ignores %s',
    (name) => {
      expect(isIgnored(name)).toBe(true);
    },
  );

  it('allows the committed template .env.example', () => {
    expect(isIgnored('.env.example')).toBe(false);
  });
});
