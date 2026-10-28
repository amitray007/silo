/**
 * Subpath entry `@silo/core/ai-credential`: the only way out of core for the
 * decrypted provider key. Worker and app composition root use it; adapters
 * (web/api/mcp) must not (Biome `noRestrictedImports` + dependency-cruiser).
 */
export type { AiCredential } from './status.js';
export { resolveAiCredential } from './status.js';
export type { AiConnectionResult, AiConnectionTester } from './tester.js';
export { setAiConnectionTester } from './tester.js';
