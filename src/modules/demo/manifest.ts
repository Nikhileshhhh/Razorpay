/**
 * Re-exported for callers already importing from `modules/demo/manifest.js`.
 * The actual implementation lives in `src/config/hashing.ts` (shared by the
 * ingestion module and the demo module).
 */
export { canonicalJsonStringify, sha256Hex, contentHash } from '../../config/hashing.js';
