# Per-feature models, Fireworks, and provider logos

A follow-up to the [AI foundation](ai-foundation.md) and [AI titles for X
posts](ai-x-titles.md), on the same branch and PR (#105) because neither has shipped.

**Status: draft for gate 1 (2026-10-28).**

## Request (Amit, 2026-10-28)

1. Remove the line "Content a feature uses, such as post text, is sent to the provider
   you choose." Done in `7010c98`.
2. Add a Fireworks AI key, and pick a model from the models Fireworks supports.
3. Show the Anthropic, OpenAI, Vercel and Fireworks logos in Settings.
4. The model choice belongs to title enrichment only. Later features may use other
   models.
5. Different providers can serve different features.

## What changes for the owner

- **Providers** become plain connected accounts: logo, name, key status, and the
  actions Add or Replace key, Test, and Remove. The "provider in use" radio goes away,
  because no single provider is in use any more.
- **Each AI feature picks its own model.** The AI tab gets a **Features** section with
  one row per registered feature. Today that is one row, "AI titles: X posts", with a
  model select. The select lists models from every provider that has a readable key,
  grouped by provider, each group headed by its logo.
- **Fireworks** is a fourth provider, with a curated list and a live list (decision 1).
- The feature's on/off switch stays in Plugins > Twitter / X (decision 2). That row
  also shows the chosen model, for example "Claude Haiku 5.5 via Anthropic".

Example: titles use Fireworks GLM 5.3 Flash, and a future chat feature uses Claude
Sonnet 5.5 via Anthropic.

## Settings shape

```ts
ai: {
  enabled: boolean,
  features: {
    'x-post-title': { enabled: boolean, model: { provider: AiProviderKind, id: string } | null },
  },
}
```

- `ai.provider` and `ai.model` are removed.
- The read path converts the old shape: `provider` + `model` become every feature's
  `model`, and a boolean flag becomes `enabled`. It nulls a model that is no longer
  reachable, as it does today. The old shape has never shipped, so this only protects
  local databases.
- The write path is strict. A model must be in the curated catalog for that provider, or
  in that provider's stored live list.
- When the owner turns a feature on with `model: null`, the UI fills it with the default
  of the first provider that has a readable key. The order is Anthropic, OpenAI,
  Gateway, Fireworks. The worker never guesses: a feature with no model is not ready.

## Readiness

`aiStatus` keeps its global part (enabled, secretKey) and gains a per-feature part:
`features: { [id]: { ready, reason, provider, model } }`. A feature is ready when AI is
on, the feature is on, its model is set, its provider has a readable key, and the model
is reachable by that provider. `runAiFeature` resolves the provider and model from the
feature, not from a global setting. The credential subpath (`resolveAiCredential`)
takes the provider kind.

## Fireworks

- **Package:** `@ai-sdk/fireworks@3.0.83`. It is a `LanguageModelV4` provider and uses
  the same `@ai-sdk/provider` 4.0.34 as `ai@7.0.155`. `createFireworks({ apiKey,
  baseURL: 'https://api.fireworks.ai/inference/v1' })`, with explicit values as for the
  other providers.
- **Structured output:** the provider sends `Output.object` as `response_format:
  json_schema`. JSON schema turns off reasoning output on Fireworks. GPT-OSS rejects
  reasoning `none`, so each catalog entry carries its tested reasoning setting.
- **Curated list** (the "Recommended" group):

  | Model | ID (`accounts/fireworks/models/...`) | Tier |
  | --- | --- | --- |
  | GLM 5.3 Flash | `glm-5p3-flash` | fast (default) |
  | Nemotron Lightning 3.5 30B A3B | `nemotron-lightning-3p5-30b-a3b` | fast |
  | DeepSeek V4.1 Flash 1017 | `deepseek-v4p1-flash-1017` | balanced |
  | GPT-OSS 120B | `gpt-oss-120b` (reasoning `low`) | balanced |

- **Live list** (the "All Fireworks models" group):
  - Fetched with the stored key from `GET https://api.fireworks.ai/v1/accounts/fireworks/models`
    with `pageSize=200` and `pageToken` paging.
  - Filtered locally: `conversationConfig` set, `supportsServerless`, `state ===
    'READY'`, and no past `deprecationDate`.
  - Stored as `{ id, label, contextLength }[]` plus `fetched_at` in a new
    `ai_providers.models` jsonb column.
  - Refreshed on Save & test, and by a Refresh action on the Fireworks row. The list
    is not a secret, but the API returns it only through the operator-only endpoints.
  - A live model gets no reasoning setting, so the provider default applies.
- **Key test:** the same 256-token test generation the other providers use, on the
  default model, then a refresh of the live list. A list fetch alone would not prove
  the key can run inference.
- **Errors:**

  | Fireworks status | Code |
  | --- | --- |
  | 401 | `invalid_key` |
  | 403, 412 (suspended) | `no_access` |
  | 404 | `model_not_found` |
  | 429 | `rate_limited` |
  | 402 (payment or limit) | new code `quota` |

  `quota` maps 402 for every provider and appears in the UI as "Out of credit or over
  the limit".
- **DB:** migration `0021` adds `fireworks` to `ai_provider_kind` and the nullable
  `models` jsonb column.

The Vercel AI Gateway keeps its curated Claude and GPT list. Fireworks models through
the Gateway are parked.

## Logos

`ProviderLogo.tsx` mirrors `PluginLogo.tsx`: inline SVG in the same themed tile, all
four marks monochrome on a 24×24 grid with `currentColor`, so both themes work.

| Mark | Source | License |
| --- | --- | --- |
| Anthropic | Simple Icons | CC0 data |
| OpenAI | Lobe Icons | MIT |
| Vercel | Simple Icons | CC0 data |
| Fireworks | Lobe Icons | MIT |

The marks identify the integration (nominative use). Anthropic's trademark page asks for
approval before its logo is used (decision 3). Each SVG file records its source URL.

## API

| Route | Change |
| --- | --- |
| `GET /api/ai` | per-feature status; providers gain `fireworks`, `models` (live list ids and labels) and `modelsFetchedAt` |
| `PUT`, `POST /test`, `DELETE /api/ai/providers/:kind` | accept `fireworks`; the test also refreshes the live list |
| `POST /api/ai/providers/fireworks/models/refresh` | new, operator-only, returns the list |
| `PATCH /api/settings` `ai` | new shape, strict |

MCP is unchanged: AI settings stay off MCP.

## Units

| Unit | Content | Focused checks |
| --- | --- | --- |
| M1 | core: settings shape, read converter, per-feature status, catalog `fireworks` entries, `quota` code, migration 0021, live-list store and write validation; API routes | old shape reads as new; a model outside catalog and live list is rejected; feature not ready without a model; two features on two providers each resolve their own |
| M2 | worker: Fireworks model, reasoning per entry, error mapping incl. 402, live-list fetcher with paging and filter, tester refresh, `runAiFeature` per-feature resolution | mock fetch for paging and filtering; a 401, 402 and 404 each map to their code; a title run uses the feature's provider |
| M3 | web: `ProviderLogo`, providers without radio, Features section with grouped select and logos, Fireworks row with Refresh, Plugins row shows the model | the select lists only providers with readable keys; Fireworks shows both groups; dark and light, desktop and phone |

Same gate and review protocol. Builds go to Sol fast, then a Sol review per unit.

QA before gate 2:
- Anthropic titles still work after the change.
- A fake Fireworks key gives `invalid_key` and an empty live list.
- With a real Fireworks key (Amit's), list the models and write titles with GLM 5.3
  Flash.

## Decisions for gate 1

1. **Fireworks models:** curated 4 plus the live list (recommended), or curated only.
2. **Feature switch:** keep the on/off switch in Plugins and put the model in the AI
   tab's Features section (recommended), or move both into the AI tab.
3. **Anthropic logo:** use the mark now as nominative use and remove it if Anthropic
   objects (recommended), or show a neutral "A" tile until approval.

## Parked

- Fireworks models through the Vercel AI Gateway.
- A background check that curated models still exist.
- A "default model" that new features inherit.
