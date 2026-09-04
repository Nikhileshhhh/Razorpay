/**
 * Small in-process limiter for the single-node prototype. It deliberately has
 * no distributed/production claims; the public contract still gets a real,
 * deterministic 429 boundary while normal idempotent retries have ample room.
 */
export class PrototypeRateLimiter {
  readonly #entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit = 60,
    private readonly windowMs = 60_000,
  ) {}

  allow(key: string, nowMs = Date.now()): boolean {
    const current = this.#entries.get(key);
    if (!current || current.resetAt <= nowMs) {
      this.#entries.set(key, { count: 1, resetAt: nowMs + this.windowMs });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}
