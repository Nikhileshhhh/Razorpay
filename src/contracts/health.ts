import { z } from 'zod';

/**
 * Health-check contract. Browser-safe: this module (and everything in
 * src/contracts) must import only browser-safe libraries so the web bundle can
 * reuse the same schemas without pulling in server code, config, or secrets.
 */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.literal('moneytrace'),
  environment: z.string(),
  time: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponse>;
