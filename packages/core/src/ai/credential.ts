/**
 * Subpath entry `@silo/core/ai-credential`: the only way out of core for the
 * decrypted provider key. Worker and app composition root use it; adapters
 * (web/api/mcp) must not (Biome `noRestrictedImports` + dependency-cruiser).
 */

export type { AiModelsFetcher } from './models.js';
export { setAiModelsFetcher } from './models.js';
export type { AiCredential } from './status.js';
export { resolveAiCredential, resolveAiFeatureCredential } from './status.js';
export type { AiConnectionResult, AiConnectionTester } from './tester.js';
export { setAiConnectionTester } from './tester.js';
