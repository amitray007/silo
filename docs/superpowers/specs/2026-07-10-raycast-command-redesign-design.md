# Raycast command redesign — the complete command set

**Status:** design approved (2026-07-10), ready for implementation plan
**Surface:** `extensions/raycast/` only. The Chrome extension is unchanged.
**Mockups:** `https://claude.ai/code/artifact/0f1cf615-2a89-46b2-b65e-b3428374e8db`
**Related:** shares the "save-first, edit-is-the-exception" model + the tag-picker with the Chrome redesign (`docs/superpowers/specs/2026-07-10-chrome-capture-redesign-design.md`).

## Why

Today the Raycast extension exposes ~3 of the silo API's ~20 endpoints: save (`POST /links`), search (`GET /links/search`), tag autocomplete (`GET /tags`). It can capture and find, but it cannot *manage* a library from Raycast — no edit, no tagging of existing links, no trash/restore, no retry, no browse-without-searching, and no images. This redesign makes Raycast the complete, keyboard-first human surface for silo, deterministic and AI-free (Claude drives silo separately over MCP — "no AI lives inside silo," and none in this extension either).

## Structure — few commands, deep actions

**Four top-level commands.** Every verb lives in the `⌘K` action panel on a result, not as its own palette entry.

| Command | Mode | Purpose |
|---|---|---|
| **Save to Silo** | no-view | Instant save, closes Raycast, HUD confirms |
| **Save to Silo with Details** | view (form) | Deliberate save with note + tags up front |
| **Search Silo** | view (list+detail) | Full-text search; all verbs in `⌘K` |
| **Browse Silo** | view (list+detail) | Whole library + by-tag + Trash (scope dropdown); same `⌘K` |

## Flows

### CMD 1 — Save to Silo (instant)

- Resolves the URL (frontmost browser tab via AppleScript, else clipboard — unchanged from today).
- `POST /api/links { url }`, then **`closeMainWindow()` + `popToRoot()`** so Raycast closes immediately.
- Confirmation is a **HUD** (`showHUD`) anchored by the silo mark: **"Saved to silo"** / **"Already in silo (updated)"** (on `deduped`) / an actionable error (**"Couldn't reach silo"**, etc.).
- **No edit prompt.** (Simplified per approval — the earlier "⌘E to edit" is dropped; editing lives in Search/Browse.) A HUD is fire-and-forget and cannot hold an action anyway, so this is also the honest choice.

### CMD 2 — Save to Silo with Details (deliberate)

- Same URL resolution, prefilled into a `Form`: URL (read-only-ish), note textarea, tag picker.
- `⌘⏎` submits `POST /api/links { url, note, tags }`, then `closeMainWindow()` + `showHUD("Saved to silo")`.
- Tag picker is the shared filter/create model (see Tag picker below).

### CMD 3 — Search Silo (list + rich detail)

- `GET /api/links/search?q=<query>` (debounced), grouped by day (Today / Yesterday / This week / Earlier — existing `groupByDay`).
- **List row:** source glyph + title + domain subtitle + tag accessories + relative time; the `◌ capturing` pulse accessory **only** while `captureStatus === 'enriching'` (mirrors the web app — "silence means complete").
- **Detail pane (`isShowingDetail`):** favicon-before-title, an image (when available), source-specific rich stats, and a metadata table. See Detail rendering below.
- **Actions:** the full `⌘K` panel (see Action set).

### CMD 4 — Browse Silo (list + detail, same as Search)

- **Same list+detail layout and detail pane as Search** — not a bare list.
- Default: `GET /api/links?limit=` (whole library, newest-first), grouped by day.
- A **scope dropdown** (`List.Dropdown` in the search bar) switches: **Library** (default) · **Trash** · a specific **tag** (populated from `GET /api/tags`).
  - Library → `GET /api/links`
  - tag → `GET /api/links?tag=<name>`
  - Trash → `GET /api/trash` (rows carry `deletedAt`); the section header shows the purge countdown (from `GET /counts`'s `purgeWindowDays` + `deletedAt`); `⏎` = Restore; the action set swaps Trash→Restore and adds Empty-trash (guarded).
- The search bar filters the current scope client-side (Browse is not a server search; that's Search's job).

## Detail rendering (Search + Browse share one component)

Built from the `CapturedLink` fields already in `types.ts` (`sourceData` variants: link / hacker_news / twitter / github / youtube), rendered with Raycast's `Detail`/`List.Item.Detail` metadata:

- **Favicon before title:** `<img>` from `${baseUrl}/api/favicon?domain=<host>` — silo's proxy, never the site directly.
- **Image (when available):** markdown image from `${baseUrl}/api/preview-image?linkId=<id>`. This proxy returns the captured og:image OR the YouTube `thumbnailUrl` (verified in `routes/preview-image.ts`). Render for YouTube (with a "▶ mm:ss · YouTube" caption), Twitter media, and any link whose `imageUrl` was captured. If the proxy 404s (no image), omit gracefully — no broken-image box.
- **Source-specific stats** (metadata rows / inline):
  - GitHub → stars, forks, issues, language
  - Hacker News → points, comments, author
  - Twitter/X → author name+handle (+ avatar via preview-image/avatar), likes, reposts, replies
  - YouTube → channel (+ thumbnail)
  - plain link → description only
- **Metadata table:** Source · Status · Saved (relative) · Tags.

**Privacy (binding):** every image/favicon loads from `${baseUrl}` (silo's proxy), NEVER from the arbitrary source host — honors silo's "no third-party calls per row." This is the one non-negotiable in the image work.

## Action set (the `⌘K` panel — "everything")

On a **live** result (Search / Browse-Library / Browse-tag):

| Action | Shortcut | API |
|---|---|---|
| Open in browser | `⏎` | `open(url)` |
| Copy URL | `⌘C` | clipboard |
| Edit note… | `⌘E` | `PATCH /api/links/:id { note }` (replace) |
| Add tag… | `⌘T` | `POST /api/links/:id/tags { tag }` |
| Remove tag… | `⌘⇧T` | `DELETE /api/links/:id/tags/:tag` |
| Retry enrichment | `⌘R` | `POST /api/links/:id/retry` |
| Filter by tag | `⌘F` | sets Browse scope to that tag |
| Move to trash | `⌃X` | `POST /api/links/:id/trash` — **confirmed** |

On a **trashed** result (Browse-Trash): Open · Copy · **Restore** (`⏎`, `POST /links/:id/restore`) · **Delete permanently** (`⌃X`, `DELETE /trash/:id`, confirmed) · **Empty trash** (`DELETE /trash`, confirmed).

**Destructive-action guard (binding):** trash / delete-permanently / empty-trash never bind to `⏎`, use a distinct modifier (`⌃X`), and show a Raycast confirmation (`confirmAlert`) — no accidental deletes from a fast keystroke.

## Tag picker (shared model)

Add-tag / Remove-tag / the details form all use one filterable tag model, matching the Chrome edit card's `tag-list.ts`: source tags from `GET /api/tags` (name + count), type-to-filter, `⏎` to toggle, a "Create '<x>'" affordance for a new tag. Case-insensitive on the trimmed value.

## Components (isolation & boundaries)

Extension stays a plain HTTP client (no `@silo/core`/`@silo/api` — biome-enforced). Building on the existing `src/lib/` structure:

- **`lib/capture-client.ts`** — extend beyond `captureLink`/`searchLinks` with: `browseLinks(filter)`, `listTrash()`, `editNote(id, note)`, `addTag(id, tag)`, `removeTag(id, tag)`, `trashLink(id)`, `restoreLink(id)`, `retryLink(id)`, `emptyTrash()`, `deleteTrashed(id)`, `listTags()`, `getCounts()`. Each a thin typed `fetch` over the verified endpoints.
- **`lib/types.ts`** — add `TrashLink` (`CapturedLink & { deletedAt }`), `TagWithCount`, `Counts`, browse/trash response envelopes.
- **`lib/image-urls.ts`** (new) — pure helpers: `faviconUrl(baseUrl, domain)`, `previewImageUrl(baseUrl, id)`. Single source of truth for the proxy URLs so the privacy rule is enforced in one place.
- **`lib/link-detail.tsx`** (new) — the shared detail component (favicon+title, image, source stats, metadata) used by both Search and Browse. This is the biggest new UI unit.
- **`lib/link-actions.tsx`** (new) — the shared `⌘K` `ActionPanel` (live variant + trash variant), so Search and Browse render identical actions.
- **`lib/tag-picker.tsx`** (new) — the shared add/remove/create tag UI over the filter model.
- **`search-silo.tsx`** — refactor to use the shared detail + actions.
- **`browse-silo.tsx`** (new command) — list+detail + scope dropdown, reusing detail + actions.
- **`save-to-silo.ts`** — add `closeMainWindow()` + `popToRoot()` after the HUD (the "close after save" requirement).
- **`package.json`** — add the `browse-silo` command; keep the other three.

## Non-goals (parked → `docs/product/future-scope.md` if they resurface)

- Any AI / Raycast AI Extension tools (explicitly rejected — plain commands only).
- `POST /ingest`, `GET/PATCH /settings` (server-config surfaces, not a capture/library UX).
- In-Raycast video/image *playback* (we show a thumbnail; `⏎` opens the source).
- Infinite-scroll pagination in Browse beyond the first page + "load more" (cursor plumbing exists; deep pagination can be a fast-follow if a library outgrows one page — `log` the cap, don't silently truncate).

## Acceptance checks

1. **Save:** invoke Save on a browser tab → link saved, Raycast **closes**, HUD "Saved to silo". Re-save same URL → "Already in silo (updated)". silo down → actionable error HUD, nothing silently dropped.
2. **Save with Details:** note + 2 tags via the picker → `⌘⏎` saves & closes; verify note+tags in the web app.
3. **Search:** query returns day-grouped results; detail shows favicon-before-title, source stats, and (for an og:image/YouTube link) an image loaded from `/api/preview-image`; an enriching link shows `◌ capturing`, gone once settled.
4. **Browse:** opens with the whole library in the same list+detail as Search; scope dropdown → a tag filters; scope → Trash shows trashed rows with purge countdown and Restore on `⏎`.
5. **Actions:** on a result, `⌘E` edits the note (replace), `⌘T`/`⌘⇧T` add/remove a tag, `⌘R` retries, `⌃X` trashes **after a confirm**; each reflected in the web app.
6. **Trash:** restore a link (it returns to Library); delete-permanently and empty-trash require confirmation.
7. **Privacy:** every image/favicon request goes to `${baseUrl}` (silo proxy), never to youtube.com/google.com/the source host (verify via network inspection or by pointing baseUrl at a stub).
8. **No stuck state:** no `captureStatus` polling loop that can hang (the `◌ capturing` accessory reflects the fetched value; a refresh re-fetches — no infinite spinner).
