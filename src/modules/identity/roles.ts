import { Role } from '../../contracts/common/roles.js';

export type { Role };

export class RoleForbiddenError extends Error {
  constructor(
    readonly requiredAnyOf: readonly Role[],
    readonly actual: readonly Role[],
  ) {
    super(`requires one of [${requiredAnyOf.join(', ')}]; actor has [${actual.join(', ')}]`);
    this.name = 'RoleForbiddenError';
  }
}

export function hasAnyRole(actual: readonly Role[], requiredAnyOf: readonly Role[]): boolean {
  return requiredAnyOf.some((r) => actual.includes(r));
}

/** Throws {@link RoleForbiddenError} (maps to `403` at the API boundary) if unmet. */
export function assertHasAnyRole(actual: readonly Role[], requiredAnyOf: readonly Role[]): void {
  if (!hasAnyRole(actual, requiredAnyOf)) {
    throw new RoleForbiddenError(requiredAnyOf, actual);
  }
}
