# AI foundation

Add an optional AI layer to silo: a master switch, provider keys, a curated model
list, a feature registry, and one runner that every AI feature uses. This slice
ships no AI feature. Its visible result: in Settings → AI you turn AI on, add a
key, pick a model, and test the connection. The first feature,
[AI titles for X posts](ai-x-titles.md), is the next slice. It builds on this one.

Later features (titles for other sources, a chat view) reuse the same layer. Each
one is its own slice.

**Status: built; passed gate 2 (2026-10-28).**

## Rules this layer must keep

1. **Optional.** With AI off, or with no key, silo behaves exactly as it does today.
   No code path outside the AI layer may require it. Every AI call has a non-AI
   result that the caller uses on any failure.
2. **Two levels of consent.** The master switch `ai.enabled` comes first. Feature
   toggles are disabled in the UI and ignored by the worker until the master switch
   is on and a provider is ready.
3. **Generic.** Features plug into one registry and call one runner. A feature never
   imports a provider SDK, reads a key, or handles retries itself.
4. **Curated models.** The owner picks from a list that silo maintains in code: the
   current top Claude and ChatGPT models. There is no free-text model ID.
5. **Keys stay on the server.** A key is encrypted at rest and never returned, logged,
   exported, or exposed over MCP.

## Decision: AI runs inside silo (approved 2026-10-28)

`CLAUDE.md`, `README.md`, `docs/README.md`, `docs/product/scope.html`,
`docs/foundation.md` and `docs/rules/mcp.md` say "No AI lives inside silo". Amit
reversed this on 2026-10-28. The new principle:

> Silo is still the substrate, and the agent over MCP still does the thinking. Silo
> may run small, optional AI features that the owner turns on with their own
> provider key. They are off by default. They never block a capture, and silo works
> fully without them.

Unit F5 writes this wording into those six files. Old plans in `docs/plans/` stay as
history.

## Evidence (2026-10-28)

- AI SDK 7 is current (`ai@7.0.155`, released 2026-06-25). Use `generateText` with
  `output: Output.object(...)`; `generateObject` and `system` are deprecated (use
  `instructions`). Zod 4 is supported
  ([structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)).
- `@ai-sdk/anthropic@4.0.90`, `@ai-sdk/openai@4.0.104`. `ai` bundles
  `@ai-sdk/gateway@4.0.128` and re-exports `createGateway`. Each provider takes
  `apiKey` at runtime.
- AI Gateway works from any server with a key, with no token markup
  ([auth](https://vercel.com/docs/ai-gateway/authentication-and-byok/authentication),
  [pricing](https://vercel.com/docs/ai-gateway/pricing)). I confirmed the model IDs
  below against the live `GET https://ai-gateway.vercel.sh/v1/models`.
- Claude lineup ([models overview](https://platform.claude.com/docs/en/about-claude/models/overview)):
  Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5. Opus and Fable always think. Sonnet 5.5
  rejects `thinking: disabled`. Haiku 5.5 can turn thinking off.
- OpenAI lineup ([models](https://developers.openai.com/api/docs/models)): GPT-6
  Astra (flagship), GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Luna. Astra and Sol offer
  reasoning from `low` up; Terra and Luna also accept `none`.
- Errors: `APICallError.requestBodyValues` holds the prompt. OpenAI's 401 message
  echoes a masked part of the key. Silo therefore returns and logs only a fixed
  error code.
- AI SDK telemetry is off unless registered. Warnings go to `process.emitWarning`;
  `globalThis.AI_SDK_LOG_WARNINGS = false` silences them.
- `node:crypto` AES-256-GCM is enough for encryption at rest. It is about 40 lines
  and protects a trust boundary, so no library.

### ChatGPT subscription via ACP: not viable now. Park it.

- ACP is JSON-RPC between an editor and a coding-agent subprocess. The Codex adapter
  (`@agentclientprotocol/codex-acp@2.3.0`) starts `codex app-server`. A title call
  would go ACP SDK → codex-acp → Codex binary → OpenAI: two adapter layers and an
  agentic binary in the container, for one short completion.
- Auth is `codex login --device-auth` (beta) or a copied `~/.codex/auth.json`, which
  holds a refresh token for the whole ChatGPT account. OpenAI's own docs say "API keys
  are still the recommended default for automation"
  ([Codex auth](https://learn.chatgpt.com/docs/auth)).
- OpenAI's official route, "Sign in with ChatGPT" (SIWC) with plan usage, is a
  preview for open-source and local apps. It says nothing about unattended use, its
  SDK is not on npm, and revoking a transferred session is "not yet available"
  ([SIWC](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)).
- Anthropic forbids third-party apps from routing requests through Pro or Max plan
  credentials ([legal](https://code.claude.com/docs/en/legal-and-compliance)).

**Decision (gate 1):** parked as "ChatGPT plan via SIWC (not ACP)" in
`docs/product/future-scope.md` and [issue #104](https://github.com/amitray007/silo/issues/104). The provider list below can add it as a fourth kind
later without other changes.

## Shape

```
Settings → AI tab                       worker / HTTP process
  master switch ─┐                      feature (e.g. x-post-title, next slice)
  provider + key ├─► settings `ai`         │ runAiFeature(id, input)
  model          │   ai_providers          ▼
  test           ┘   (encrypted)        gate: ai.enabled? feature on? credential?
                                           │ no ──► { ok: false, code: 'off' } → caller uses its default
                                           ▼ yes
                                        languageModelFor(credential, catalog entry)
                                           │ generateText + Output.object
                                           │ timeout, retries, reasoning from catalog
                                           ▼
                                        postProcess → value, or { ok: false, code }
```

## Model catalog (`packages/core/src/ai/catalog.ts`)

A code constant. Updating the list is a one-file change plus its test. Each entry:
`{ id, family: 'claude' | 'chatgpt', label, tier: 'fast' | 'balanced' | 'best',
anthropicId?, openaiId?, gatewayId, reasoning }`. `reasoning` is the lowest setting
that the model accepts, so short tasks stay fast.

| Label | Tier | Direct ID | Gateway ID | Lowest reasoning | $/MTok in/out |
| --- | --- | --- | --- | --- | --- |
| Claude Haiku 5.5 | fast | `claude-haiku-5-5` | `anthropic/claude-haiku-5.5` | `none` | 0.10 / 0.50 |
| Claude Sonnet 5.5 | balanced | `claude-sonnet-5-5` | `anthropic/claude-sonnet-5.5` | `low` | 2 / 10 |
| Claude Opus 5.5 | best | `claude-opus-5-5` | `anthropic/claude-opus-5.5` | `low` | 4 / 20 |
| Claude Fable 5.1 | best | `claude-fable-5-1` | `anthropic/claude-fable-5.1` | `low` | 10 / 50 |
| GPT-6 Luna | fast | `gpt-6-luna` | `openai/gpt-6-luna` | `none` | 0.10 / 0.50 |
| GPT-6.1 Terra | balanced | `gpt-6.1-terra` | `openai/gpt-6.1-terra` | `none` | 1 / 5 |
| GPT-6.1 Sol | balanced | `gpt-6.1-sol` | `openai/gpt-6.1-sol` | `low` | 2 / 10 |
| GPT-6 Astra | best | `gpt-6-astra` | `openai/gpt-6-astra` | `low` | 10 / 50 |

The picker groups by family ("Claude", "ChatGPT") and shows only the models that the
active provider can reach. An Anthropic key shows Claude, an OpenAI key shows
ChatGPT, and a Gateway key shows both. The default is the `fast` model of the
provider's family (Gateway: Claude Haiku 5.5). The builder confirms the `reasoning`
values against the AI SDK provider mapping. A stored model ID that leaves the catalog
(or that the provider cannot reach) reads back as `null`, so the provider's default is
used. AI stays on. Release notes announce removed models.

## Feature registry (`packages/core/src/ai/features.ts`)

`AI_FEATURES` is a list of `{ id, label, description, plugin?: PluginKind }`. Core
owns this list because Settings validates against it and the UI renders from it.
The worker owns each feature's behavior (prompt, schema, post-processing) in a
matching `AiFeatureDefinition`. A module-load drift guard checks both sides,
as `enrich-source/index.ts` already does for plugins.

Where a toggle appears: a feature with a `plugin` shows its toggle in that plugin's
section on the Plugins tab. A feature with no plugin (a future chat view) shows it on
the AI tab. This slice registers no feature, so the guard allows an empty list and
no feature toggle appears yet.

## Settings and storage

### Settings key `ai` (not secret, in the existing `settings` table)

```ts
ai: {
  enabled: boolean,                         // master switch, default false
  provider: 'anthropic' | 'openai' | 'gateway' | null,   // default null
  model: string | null,                     // catalog id; null = provider default
  features: Record<AiFeatureId, boolean>,   // default all false
}
```

Validation: `model` must be in the catalog and reachable by `provider`; `features`
keys must be registered (`.strict()` against the registry). The `api/routes/settings.ts`
edge schema and the web `SettingsMap` type gain the same key.

### Table `ai_providers` (one row per provider kind)

| Column | Notes |
| --- | --- |
| `kind` | PK, enum `ai_provider_kind` = `anthropic \| openai \| gateway` |
| `encrypted_key` | `v1.<kid>.<iv>.<tag>.<ciphertext>`, base64url parts |
| `key_last4` | last 4 characters, for display |
| `last_test_ok`, `last_test_at`, `last_test_code` | the code is from the fixed list only |
| `created_at`, `updated_at` | |

Several keys can be stored at once. `ai.provider` picks the one in use.

### "Ready"

`aiReadiness()` in core returns `{ ready: true, credential } | { ready: false, reason }`.
The reason is one of `disabled`, `no_secret_key`, `no_provider`, `no_key`, or
`key_unreadable`. The UI and the runner both use it, so they never disagree about
whether AI is usable.

## Key security

### Encryption

- `SILO_SECRET_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`). Only core's
  `ai/secret-box.ts` reads it.
- AES-256-GCM with a random 12-byte IV for each encryption and a 16-byte tag. The AAD
  is `silo/ai-provider/<kind>`, so a ciphertext copied to another row fails to
  decrypt.
- `kid` = the first 8 hex characters of SHA-256 of the key.
- Rotation: put the new key in `SILO_SECRET_KEY` and the old one in
  `SILO_SECRET_KEY_PREVIOUS` (comma list). At startup the worker re-encrypts each row
  whose `kid` is not current, in one transaction. Then the operator removes the old
  key. A row that no configured key decrypts reads as `key_unreadable`, and the UI
  asks for the key again.
- Unset or malformed key: silo starts normally and AI stays unavailable. A malformed
  key logs one line naming the variable; an unset key logs nothing, so an owner who
  never uses AI sees no noise. The AI tab explains the fix, and saving a key returns
  `409 secret_key_missing`.

### Where the plaintext exists

1. The `PUT` request body. Core encrypts it at once.
2. Process memory, for the length of one AI call. Only `aiReadiness()` decrypts.

It never appears in a response, log line, error envelope, MCP output, export, or the
`settings` map. Tests enforce:

- `listAiProviders()` never selects `encrypted_key`; responses carry `keyLast4` only.
- An invalid `PUT` body containing a key returns a `400` whose body does not contain
  the key. Zod 4 issues omit `input` by default; the test proves it.
- `ai/errors.ts` maps every provider error to a fixed code: `invalid_key | no_access |
  model_not_found | rate_limited | timeout | network | provider_error`. A test feeds
  an `APICallError` whose body contains the key and checks that neither the result
  nor the log line contains it.
- No custom base URL, so nobody with settings access can send the key to their own
  host.
- Export and import never touch `ai_providers`.

### Who may change AI settings

`PUT`, `DELETE` and `test` on `/api/ai/*` accept only the web session cookie (with
the existing CSRF header) or the operator's env `SILO_API_TOKEN`. Named access tokens
and MCP OAuth tokens, which extensions and agents hold, get `403`. With no auth
configured (localhost), the routes stay open like the rest of the API.
`generalTokenAuth` records which branch matched (`c.set('authKind', ...)`), and an
`operatorOnly` middleware checks it. `PATCH /api/settings` gets the same check when
the patch touches `ai`.

No MCP tool manages AI settings. This is a deliberate exception to the parity rule
because of the key. Record it in future-scope next to `empty_trash`.

## Runner (`packages/worker/src/ai/`)

New deps in `@silo/worker`: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, at the
exact versions from `npm view`.

- `model.ts`: `languageModelFor(credential, entry)` uses `createAnthropic`,
  `createOpenAI` or `createGateway` with `{ apiKey }` and the entry's ID for that
  provider. This is the only file that knows provider SDKs.
- `define.ts`: `AiFeatureDefinition<In, Out>` = `{ id, promptVersion, instructions,
  buildPrompt(input), schema, postProcess(output): Out | undefined, timeoutMs }`.
- `run.ts`: `runAiFeature(id, input)` returns `{ ok: true, value } | { ok: false,
  code }` and never throws:
  1. Check `ai.enabled`, `ai.features[id]` and `aiReadiness()`. If any fails, return
     `{ ok: false, code: 'off' }` without a network call.
  2. Call `generateText` with `output: Output.object({ schema })`, the catalog entry's
     `reasoning`, `maxRetries: 2` (AI SDK backoff on 429, 5xx and network errors),
     a total `timeout` of the feature's `timeoutMs`, and telemetry off.
  3. Run `postProcess`. `undefined` returns `{ ok: false, code: 'invalid_output' }`.
  4. Log one line per failure: `silo ai: <feature>@v<version> failed (<code>)`. Log no
     prompt, output, or key.
- `connection-test.ts`: implements core's `setAiConnectionTester` port. It sends a
  fixed 5-word prompt to the chosen model, so one test checks the key and the model.
  `@silo/app`'s `api-main.ts` registers it in the HTTP process, as it does for
  `registerLinkTitles`.
- `index.ts` sets `globalThis.AI_SDK_LOG_WARNINGS = false` once.

A later chat view adds `streamAiChat` beside `runAiFeature` on the same
`languageModelFor`, catalog and `aiReadiness()`. This slice does not build it.

## API

| Route | Body / result |
| --- | --- |
| `GET /api/ai` | `{ status, providers: [{ kind, configured, keyLast4, keyReadable, lastTest }], catalog, features }` |
| `PUT /api/ai/providers/:kind` | `{ apiKey }`, 8-300 printable ASCII characters, trimmed. Saves, runs the test, returns the row |
| `POST /api/ai/providers/:kind/test` | `{ ok, code?, latencyMs }` |
| `DELETE /api/ai/providers/:kind` | `204`; also clears `ai.provider` and `ai.model` when they point at this kind |
| `PATCH /api/settings` | existing route; now carries `ai` |

## Settings UI

A new **AI** tab after Plugins, with the description "Optional AI features, using your
own provider key." It reuses `rowStyles`, `ToggleSwitch` and the Access tab's row and
two-step-remove patterns. It follows `docs/design/tokens.md`: Inter, the oklch neutral
palette, and ink primary buttons.

1. **Use AI** master switch, with the description "Off by default. Silo works the same
   without it." While it is off, everything below is visible but dimmed, so the owner
   can see what turning it on involves.
2. **Provider**: three rows, Anthropic, OpenAI and Vercel AI Gateway. Each row shows
   a status line ("Not set", "Key ••••abcd · Tested 2 min ago", or "Key rejected") and
   the actions Add key or Replace key, Test, and Remove (two-step). A radio picks the
   provider in use; a row with no key cannot be picked. The key field uses
   `type="password"`, `autocomplete="off"` and `spellCheck={false}`. Save & test
   clears the field. The UI never receives the key back.
3. **Model**: a select grouped by "Claude" and "ChatGPT", listing only the catalog
   models the provider reaches. Each option shows its label and tier ("fast",
   "balanced", "best").
4. One quiet line: "Content a feature uses, such as post text, is sent to the
   provider you choose."
5. When `SILO_SECRET_KEY` is missing, one callout replaces sections 2 and 3: "Set
   SILO_SECRET_KEY on the server to store keys", with the `openssl` command.

No other screen changes in this slice.

## Units

Each unit goes through the binding review protocol before the next starts. Sonnet
builds from this file. The Opus lead reviews and integrates.

| Unit | Content | Focused checks |
| --- | --- | --- |
| F1 | `secret-box`, `ai_providers` table and migration, core provider CRUD, startup re-encryption | round trip; wrong AAD or kid fails; a tampered tag fails; rotation re-encrypts; a missing key degrades; the list has no ciphertext |
| F2 | catalog, feature registry, settings key `ai`, `aiReadiness()` | invalid model, unknown feature and unreachable model are rejected; each readiness reason; a model removed from the catalog falls back |
| F3 | worker runner, `languageModelFor`, errors, connection-test port, `reencryptAiProviders()` at worker startup | `MockLanguageModelV3` from `ai/test`: success, timeout, 401, 429 then success, 429 three times, invalid output, AI off makes no call; console spy shows no key or prompt |
| F4 | `/api/ai` routes, `operatorOnly` (also on `PATCH /api/settings` with `ai`), a Biome `noRestrictedImports` rule that keeps `resolveAiCredential` and `setAiConnectionTester` out of api, mcp and web, AI tab | `403` for a DB token, `403` without CSRF, the key absent from every response including errors; web tests for each tab state |
| F5 | docs: principle, `docs/rules/ai.md`, `deploy.md`, `.env.example`, compose, future-scope | `pnpm quality` |

Whole-tree gate after each unit:
`DATABASE_URL=postgres://silo:silo@localhost:5432/silo_unused TEST_DATABASE_URL=postgres://localhost:5432/postgres CI_REQUIRE_DB=1 pnpm turbo run check-types test`
and `pnpm quality`.

Review after F1, F3 and F4: `ce-code-review` with the security, correctness and
adversarial personas.

QA before gate 2, against a real Postgres and real keys:

1. With AI off and no `SILO_SECRET_KEY`, capture 10 real links of each source; the
   results match `main`.
2. Add each provider's key, test it, switch models, and check that the model list
   follows the provider.
3. Use a wrong key and a revoked key: each shows "Key rejected", with no key text in
   the UI, API logs or worker logs.
4. Rotate `SILO_SECRET_KEY` and confirm the connection still tests ok. Remove the key
   and confirm the callout appears and capture is unaffected.
5. Search a DB dump, both logs and an export file for the key and its middle
   characters.
6. A named access token gets `403` on `PUT /api/ai/providers/anthropic`.

## Docs (unit F5)

- The principle wording above, in the six files.
- New `docs/rules/ai.md`: the five rules at the top of this file, plus "one runner,
  features register; prompts are versioned and owned by their feature".
- `docs/deploy.md`, `.env.example`, `docker-compose.prod.yml`: `SILO_SECRET_KEY`,
  `SILO_SECRET_KEY_PREVIOUS`, and the rotation steps.
- `docs/product/future-scope.md`: ChatGPT plan via SIWC; a per-feature model choice;
  a chat view; the MCP exception for AI settings.

## Gate 1 decisions (2026-10-28)

1. The principle change and its wording: approved.
2. The ChatGPT-subscription provider: parked, [issue #104](https://github.com/amitray007/silo/issues/104).
3. Only the web session or the operator token may change AI settings: approved.
4. Enrich shows on every link and never downgrades a `full` link (X titles slice): approved.
