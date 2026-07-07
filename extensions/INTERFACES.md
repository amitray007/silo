# Extensions — capture-contract interfaces

This documents the frozen contract both `extensions/chrome/` and
`extensions/raycast/` build against — the CORS + token seam on `@silo/api`,
and the capture/search HTTP contract each extension is a thin client of.
Both extensions are plain HTTP clients: they do NOT import `@silo/*`
workspace packages (enforced by the `extensions/**` `noRestrictedImports`
biome override) — they define their own request/response types.

## The two independent config surfaces

1. **The API decides which origins + whether a token is required.**
   - `SILO_ALLOWED_ORIGINS` (comma-separated env) — the CORS allowlist for
     `/api/*`. Unset → `http://localhost:5173` + `http://localhost:8787`.
     Set → exactly that list (a production deploy must add
     `chrome-extension://<extension-id>` explicitly). Never `*`.
   - `SILO_API_TOKEN` (env) — unset → no auth required on `/api/*` (today's
     localhost default). Set → every `/api/*` request needs
     `Authorization: Bearer <token>`, or `401`. `GET /health` is exempt
     (mounted outside `/api`).
   - See `packages/api/src/cors.ts` and `packages/api/src/general-auth.ts`.

2. **The extension decides which silo it calls + what token to send.**
   - **Base URL** preference/option, default `http://localhost:8787`.
   - **API token** preference/option, empty by default. When set, sent as
     `Authorization: Bearer <token>` on every request.
   - Chrome: `extensions/chrome/src/lib/settings.ts` (persisted in
     `chrome.storage.local`, edited via the options page). Also needs
     Chrome's OWN `host_permissions`/`optional_host_permissions` grant for
     the configured origin — independent of the API's CORS allowlist; both
     gates must pass for a non-default base URL to work.
   - Raycast: `extensions/raycast/src/lib/preferences.ts` (Raycast
     `preferences`, no CORS constraint — Node runtime, plain
     server-to-server `fetch`).

Localhost dev (no `SILO_API_TOKEN`, default `SILO_ALLOWED_ORIGINS`): both
extensions work with zero configuration beyond loading them.

## The capture contract (`POST /api/links`)

```
POST /api/links
{ url: string, tags?: string[], note?: string, sourceKind?: 'link' | 'hacker_news' | 'twitter' }

-> 201 { link: LinkJson, deduped: boolean }
-> 400 { error: 'validation_error', message, details? }   (bad/unparseable URL)
-> 401 { error: 'unauthorized', message }                 (SILO_API_TOKEN set, missing/bad token)
```

`deduped: true` means the URL already existed and this request folded into
it (existing tags/note merged) rather than creating a new link — both
extensions surface this distinctly ("Already in silo (updated)").

Neither extension sends `title`/`sourceData` on capture — that's
enrichment's job, run entirely by silo's backend after the row is created.
**Binding UX rule for both extensions: never block the capture
confirmation on enrichment.** The response's `link.captureStatus` may be
`'enriching'` — that's expected and fine to show as-is (Chrome's recent-5
list shows a `◌ capturing` pulse; nothing waits for it to settle).

## The search contract (`GET /api/links/search?q=`)

```
GET /api/links/search?q=<query>&limit=&cursor=
-> 200 { results: (LinkJson & { rank: number })[], nextCursor?: string }
```

Used by Raycast's Search Silo command. `sourceData` is a discriminated union
keyed on `kind` (`link` | `hacker_news` | `twitter` | `github` | `youtube`)
— see `packages/core/src/links/source-data.ts` for the canonical shape;
each extension mirrors only the fields it renders.

## Error handling (both extensions)

Both `capture-client.ts` modules throw a typed `CaptureError` with a `kind`:
`'unreachable'` (network failure — for Chrome, also covers a CORS
rejection, since `fetch` throws the same generic error for both and there's
no way to distinguish them from the result), `'unauthorized'` (401),
`'invalid'` (400, bad URL), `'server'` (5xx), `'unknown'`. Every entry point
(Chrome's toast, Raycast's HUD/toast) surfaces `error.message`, never a
silent failure.

## Icons / GET /api/tags

`GET /api/tags -> { tags: { name: string; count: number }[] }` — used by the
Chrome popup's tag autocomplete only. Not used by Raycast.
