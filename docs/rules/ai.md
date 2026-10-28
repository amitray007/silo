# AI layer rules

silo's AI features are optional. The owner turns them on with their own provider key.
The design is in [`docs/methods/ai-foundation.md`](../methods/ai-foundation.md). Rules
marked **ENFORCED** fail the gate.

## Rules

1. **Optional.** With AI off or no key, silo behaves as if the AI layer did not exist.
   No code outside `packages/core/src/ai/` and `packages/worker/src/ai/` may require it.
   Every AI call has a non-AI result, and the caller uses it on any failure.
2. **Two levels of consent.** The master switch `ai.enabled` comes first. A feature
   runs only when the switch is on, the feature is on, and a provider is ready
   (`isAiFeatureOn`).
3. **One runner.** A feature defines an `AiFeatureDefinition` (prompt, schema,
   post-processing, timeout) and calls `runAiFeature`. A feature never imports a
   provider SDK, reads a key, or handles retries itself. `languageModelFor` in
   `packages/worker/src/ai/model.ts` is the only file that imports provider SDKs.
4. **Never block or fail a capture.** `runAiFeature` never throws. A capture never waits
   longer than the feature's timeout, and never retries because of AI.
5. **Curated models.** The owner picks from `AI_MODEL_CATALOG`
   (`packages/core/src/ai/catalog.ts`). There is no free-text model ID and no custom
   base URL. Provider base URLs are fixed in code, so environment variables cannot
   redirect a key.
6. **Prompts are versioned.** Each feature owns its prompt next to its plugin and bumps
   `promptVersion` on every wording change. Tests check behavior (sanitizer, fallback),
   not prompt wording.
7. **Registry parity.** Every core `AI_FEATURES` entry has a worker definition and the
   reverse. **ENFORCED** by the drift guard in `packages/worker/src/ai/registry.ts`.

## Keys

- Keys are encrypted with AES-256-GCM under `SILO_SECRET_KEY` and bound to their row.
  Only `packages/core/src/ai/` encrypts or decrypts.
- A key never appears in a response, log line, error body, export, the settings map,
  MCP output, a URL, a client cache, or the DOM after save. Only the last 4
  characters are shown.
- Provider errors become a fixed code (`invalid_key`, `rate_limited`, ...). A provider
  message, response body, or request body is never logged or returned.
- The decrypted credential lives in the `@silo/core/ai-credential` subpath, not in the
  root barrel. Adapters (api, web, mcp) may not import it. **ENFORCED** by Biome
  `noRestrictedImports` (and a dependency-cruiser rule).
- Only the web session (with `X-Silo-CSRF`) or the operator token `SILO_API_TOKEN` may
  change AI settings or keys. Named access tokens and MCP OAuth tokens get `403`.
- No MCP tool manages AI settings. This is a deliberate exception to agent parity.
