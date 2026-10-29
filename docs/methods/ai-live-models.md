# Live model lists for every provider, and a searchable model picker

Follows [per-feature models](ai-feature-models.md), on the same branch and PR (#105).

**Status: approved at gate 1 (2026-10-29) with the three recommended choices.**

## Request (Amit, 2026-10-29)

Fetch the models from Anthropic, OpenAI and the Vercel AI Gateway with the owner's own
key, as Fireworks already does, so silo keeps no model list. The picker then holds many
models, so it needs a search box that searches across providers and a provider filter.

## Evidence (research, 2026-10-29)

| Provider | List endpoint | What it tells us | Filter |
| --- | --- | --- | --- |
| Anthropic | `GET /v1/models`, paged by `after_id`, `limit` up to 1,000 | `display_name`, `created_at`, `lifecycle`, `max_input_tokens`, `capabilities` (structured outputs, thinking types, effort levels) | `lifecycle` active and `capabilities.structured_outputs.supported` |
| OpenAI | `GET /v1/models`, one page | only `id`, `created`, `owned_by`, `shutdown_date`; no capability fields | an id-pattern rule (below) and no past `shutdown_date` |
| Gateway | `GET https://ai-gateway.vercel.sh/v1/models?include_availability` with the key | `type`, `tags`, `context_window`, `pricing`, `reasoning_options`, eligibility | `type` language, `tags` has `structured-output`, eligible, not deprecated: about 272 today |
| Fireworks | built already | chat, serverless, `READY`, deprecation | unchanged |

- Opus 5.5 and Fable 5.1 require thinking, and Sonnet 5.5 rejects disabled thinking.
  So the generation settings must come from each model's own capabilities, not from
  one blanket setting.
- OpenAI reasoning models accept different effort values. For example, GPT-6 Astra
  and GPT-6.1 Sol reject `none`.
- `@ai-sdk/openai` uses the Responses API, and current GPT-5 and GPT-6 models support
  `json_schema`. Pro variants differ.

## Behavior

- **No catalog.** `catalog.ts` and its curated entries go away. Every provider's
  models come from its live list, stored per provider as Fireworks' list is today:
  `ai_providers.models`, `models_fetched_at` and `models_refresh_error`.
- **Refresh:**
  - Silo refreshes a provider's list when a key is saved or tested, and when the owner
    clicks Refresh on its row.
  - Operator reads (`open`, `env_token` or `session`) refresh in the background any
    list older than 24 hours. Named tokens receive the stored list without starting
    a refresh.
  - After a failed refresh, automatic retries wait 15 minutes, then double the wait
    up to 6 hours. This backoff is per provider and process. Success or a key change
    resets it. Manual Refresh and Save & test bypass it.
  - Concurrent refreshes share a request only when both provider and encrypted key
    match. A result fetched with an old key cannot replace the new key's list.
  - A failed refresh keeps the old list and shows "Couldn't refresh the list", as it
    does for Fireworks.
- **Gateway eligibility.** Annotated lists keep only rows whose
  `model_eligibility.status` is `eligible`. Rows marked `ineligible` or `unknown`,
  and rows missing annotations in an annotated response, are excluded. An
  unannotated list is marked `unverified`; it does not prove team eligibility.
  The keyed fetch does not fall back to the public catalog on failure. Annotation
  shape follows the [Gateway REST API](https://vercel.com/docs/ai-gateway/sdks-and-apis/rest-api#team-availability-annotations).
- **OpenAI filter.** The rule matches id patterns, not model names, so it holds for
  future models. It admits general-purpose `gpt-` and `o` families with known suffixes:
  `mini`, `nano`, `luna`, `terra`, `sol`, `astra`, and dated snapshots. It excludes
  audio, realtime, transcribe, tts, image, search, codex, embedding, moderation, `pro`,
  preview and fine-tuned (`ft:`) ids.
- **Default model per provider**, used when a feature is turned on with no model:
  - Anthropic: the newest `haiku`.
  - OpenAI: the newest `luna`, then `mini`, then `nano`.
  - Gateway: the newest eligible Haiku, then Luna, then Flash.
  - Fireworks: `glm-5p3-flash` when listed.
  - Each provider falls back to its newest listed model.
- **Generation settings per model**, worked out from the stored record:
  - **Anthropic:** turn thinking off when the model allows it. Otherwise use the
    lightest thinking mode it supports, at its lowest effort. Use native structured
    output.
  - **OpenAI:** use reasoning effort `none` where the model accepts it, else `low`.
    Ids that are not reasoning models get no reasoning option.
  - **Gateway:** pick the lowest value the model's `reasoning_options` advertise.
  - **Fireworks:** keep `low`.
  - **All providers:** allow 1,024 output tokens. After a 400 that identifies an
    option or its value as unsupported, not supported, invalid, unknown or unrecognized,
    retry once without that option. Remember the fallback only if that immediate
    retry succeeds. Keep at most 200 provider/model entries for 7 days. A message
    that merely mentions reasoning does not qualify. When the output budget runs out
    with no JSON, retry once with 4,096 tokens inside the same deadline. Never retry
    an auth failure.
- **Settings write:** the chosen model must be in that provider's stored list.
  Existing choices such as `claude-haiku-5-5` stay valid when the live list has them.
  The read path nulls a model that has left the list, as it does today.
  Before lookup, reads and writes migrate pre-live-list Gateway catalog ids using
  one legacy map. A write persists the mapped id. Direct provider ids do not change:

  | Former Gateway catalog id | Gateway live id |
  | --- | --- |
  | `claude-haiku-5-5` | `anthropic/claude-haiku-5.5` |
  | `claude-sonnet-5-5` | `anthropic/claude-sonnet-5.5` |
  | `claude-opus-5-5` | `anthropic/claude-opus-5.5` |
  | `claude-fable-5-1` | `anthropic/claude-fable-5.1` |
  | `gpt-6-luna` | `openai/gpt-6-luna` |
  | `gpt-6.1-terra` | `openai/gpt-6.1-terra` |
  | `gpt-6.1-sol` | `openai/gpt-6.1-sol` |
  | `gpt-6-astra` | `openai/gpt-6-astra` |

## The picker

The model select becomes a popover combobox built on `cmdk`. The ⌘K palette already
uses `cmdk`.

```
┌──────────────────────────────────────────────┐
│ 🔍 Search models                             │
│ [All] [Anthropic] [OpenAI] [Gateway] [Fire…] │
├──────────────────────────────────────────────┤
│ ⟁ Anthropic                                  │
│   Claude Haiku 5.5               ✓  200K     │
│   Claude Sonnet 5.5                 200K     │
│ ◎ OpenAI                                     │
│   GPT-6 Luna                        400K     │
│ ▲ Gateway                                    │
│   anthropic/claude-haiku-5.5        200K     │
└──────────────────────────────────────────────┘
```

- **Search** matches case-insensitive substrings in the label, id and owner across
  every provider. Each whitespace-separated query token must match one of those fields.
  Within each provider, matches rank by label prefix, label word prefix, label
  substring, then id or owner substring. Ties use newest first.
- **Provider chips:**
  - "All" plus one chip per provider with a readable key, each with its logo.
  - Chips are 26px tall, with 14px logos and muted model counts. They scroll
    horizontally when they do not fit. Group headings use 12px muted text and 14px logos.
  - A chip narrows the list. The chosen chip persists while the picker is open.
- **Rows:**
  - Rows are 44px tall. The label uses 13px text at weight 500. The id appears
    beneath it in 12px muted text when it differs, on one line with an ellipsis.
  - Rows also show the context window when it is known. Counts of one million or more
    use M with at most one decimal and no trailing `.0` (1M, 1.5M). Smaller counts
    use whole K (262K, 131K, 200K).
  - The context window and current-choice tick align to the right of the label line.
  - Gateway rows show the owner, for example "anthropic".
  - With an empty query, rows are sorted newest first within each provider.
    The current choice has a tick.
- **Behavior:**
  - The desktop popover aligns to the trigger's right edge. Its width is the greater
    of the trigger width and 380px, capped at 420px and the visible Settings pane width.
  - It prefers opening below the trigger. When below has less than 400px and above
    has more room, it opens above with a fixed bottom anchor and a height up to 400px.
  - Both directions clamp to the visible Settings content pane, inset by 8px, with
    a 4px gap from the trigger. The header and close button stay clear. The list
    scrolls at 320px or less when space is limited. Scrolling or resizing the pane
    updates the position. Filtering does not move the anchor.
  - The floating surface uses `--bg2`, lifted toward `--ink` by 4% in dark mode,
    a 1px `--line` border, `--menu-shadow`, and an 8px menu radius. Inset rows use
    `--menu-highlight` and `--menu-highlight-shadow` for hover and active states.
  - Search is 36px tall with a 16px icon. There is no Close text button. An outside
    click or Escape dismisses the picker and restores focus to the trigger.
  - Arrow keys, Enter and Escape follow the existing dropdown fix. Escape closes only
    the popover.
  - Typing goes straight into the search field.
  - Opening with an empty query makes the current choice active and scrolls it into
    view. Each query change resets the list to the top and makes the first match
    active, including when the query clears.
- **Empty states:**
  - "No models match" when the search finds nothing.
  - "Add a key in Providers" when no provider is ready.
- **Phone (up to 640px):** the picker opens as a full-width bottom sheet, capped at
  70dvh, with the same compact controls and elevated surface as desktop.

## Units

| Unit | Content | Focused checks |
| --- | --- | --- |
| L1 | core and worker: per-provider live-list store for all four providers, the Anthropic, OpenAI and Gateway fetchers with filters and paging, the normalized model record, default rules, per-model generation settings, retry-without-option, the 4,096-token retry, remembered settings, catalog removal, settings validation against the lists, background refresh | mock fetch per provider for filters and paging; the OpenAI pattern table; default-rule table; Opus gets thinking, Haiku none; Astra gets `low`; retry paths |
| L2 | web: the `cmdk` model picker with search and provider chips, Refresh on every provider row, the stale-list hint everywhere, the phone sheet | search across providers; chips filter; keyboard; empty states; dark and light, desktop and phone |

Builds go to Sol fast, with a Sol review per unit, as before. For QA, Amit's
Anthropic and Fireworks keys list and title real posts; OpenAI and Gateway are
checked with fake keys for errors, plus the public Gateway list.

## Gate 1 decisions (2026-10-29)

1. OpenAI uses the id-pattern rule that hides audio, image, codex, pro and the other
   non-chat families.
2. The Gateway shows every structured-output language model, about 272; search
   handles the size.
3. Lists refresh on key save or test, on Refresh, and in the background when the AI
   tab opens and a list is over 24 hours old.

## Parked

- Pricing in the picker (Gateway and Fireworks report it, Anthropic and OpenAI do
  not).
- A "recommended" badge.
