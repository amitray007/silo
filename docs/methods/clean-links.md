# Method: clean links

## Goal

A saved link shows, opens, copies, and serves over MCP without marketing query
parameters. The owner controls which params count as tracking, for every site
and per site. A link without a title shows a readable fallback, not the raw
URL.

Today a link saved as
`https://bigthink.com/the-well/the-consciousness-theory-that-connects-you-to-everything/?utm_source=x&utm_medium=social&utm_campaign=articles&utm_content=mcgilchrist`
with no title shows that whole string as its title in the reader and the list.
After this change it shows `The consciousness theory that connects you to
everything`, and Open and Copy use the URL without the `utm_*` params.

## Frozen decisions

1. **Clean at read time. Never rewrite stored data.** `links.url` keeps the raw
   URL exactly as captured. The served URL is computed when a link leaves core
   for an adapter. Effect: a wrong rule is fixed by editing the rule, and the
   fix applies to every link. The change needs no migration or backfill and
   loses no data.
2. **One setting, on by default, fully editable.** `linkCleaning` holds the
   on/off switch, the "every site" param list, and the per-site rules. Its
   default value is the curated list below. The owner can add, edit, and
   remove any entry, including the defaults. "Reset to defaults" restores the
   curated list. Default on is safe because of decision 1.
3. **Keep wins.** A per-site keep entry protects a param on that site from
   every strip list. This is how the owner fixes a site that needs a param the
   global list strips.
4. **Curated list in code, not the ClearURLs catalog.** The catalog is large,
   regex-heavy, and its 2026 maintenance status is unconfirmed. Parked in
   `future-scope.md`. Known cost: a curated entry added in a later release does
   not reach an owner who already edited the lists, until they reset.
5. **Dedup does not change.** `canonicalize` and its conservative list stay as
   they are. Cleaning is a display and serve concern only. Known cost: an
   agent that re-captures a served clean URL can create a duplicate when the
   cleaner stripped a param the dedup list keeps (for example YouTube `si`).
   A duplicate is the harmless failure (see `canonicalize.ts`). Unifying the
   two lists with a canonical backfill is parked.
6. **The API and MCP `url` field becomes the served URL.** A new field
   `originalUrl` always carries the raw URL. Every existing consumer (open,
   copy, domain chip, title fallback, MCP text) gets the clean URL with no
   per-site edit.
7. **Title fallback drops the query and humanizes the slug.** The domain
   already shows under the title, so the fallback is the page name only.
8. **Settings live in a new "Links" tab.** The editor is too large for
   Preferences.

## Rules

`cleanUrl(rawUrl, config)` is pure and never throws. When cleaning is off, or
the URL does not parse as http(s), it returns the input unchanged.

A site rule matches the host and its subdomains (`youtube.com` matches
`m.youtube.com`). Param names match case-insensitively. An entry ending in `*`
is a prefix match (`utm_*`). For each query param:

1. A matching site rule lists it under `keep`: keep.
2. A matching site rule lists it under `strip`: strip.
3. The every-site list has it: strip.
4. Otherwise keep.

The cleaner touches only the query. It leaves scheme, host, path, and hash
unchanged, and keeps the remaining params in their original order. When no
params remain, it drops the `?`.

Default every-site list:
`utm_*`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `dclid`, `msclkid`, `yclid`,
`ttclid`, `twclid`, `li_fat_id`, `igshid`, `igsh`, `mc_cid`, `mc_eid`,
`_hsenc`, `_hsmi`, `__hstc`, `__hssc`, `__hsfp`, `hsCtaTracking`, `mkt_tok`,
`_gl`, `vero_id`, `oly_anon_id`, `oly_enc_id`, `rb_clickid`, `s_cid`,
`wickedid`, `srsltid`.

Default site rules (all `strip`, no `keep`):

| Site | Strip |
| --- | --- |
| `youtube.com` | `si`, `feature`, `pp` |
| `youtu.be` | `si`, `feature`, `pp` |
| `open.spotify.com` | `si`, `context` |
| `x.com` | `s`, `t`, `ref_src`, `ref_url` |
| `twitter.com` | `s`, `t`, `ref_src`, `ref_url` |
| `instagram.com` | `igsh` |
| `linkedin.com` | `trk`, `trackingId`, `lipi`, `rcm` |
| `reddit.com` | `share_id`, `rdt` |
| `nytimes.com` | `smid`, `smtyp` |
| `medium.com` | `source` |

Each default entry is a param that only tracks. When unsure, leave it out: a
kept tracker is harmless, a stripped page-defining param breaks the link.

## Setting

In `packages/core/src/settings/schema.ts`:

```ts
const paramName = z.string().regex(/^[A-Za-z0-9_.\-~[\]]{1,100}\*?$/);
const siteDomain = z.string().max(253).regex(/^(?!www\.)[a-z0-9-]+(\.[a-z0-9-]+)+$/);

const siteRule = z.object({
  domain: siteDomain,
  strip: z.array(paramName).max(100),
  keep: z.array(paramName).max(100),
}).strict();

linkCleaning: z.object({
  enabled: z.boolean(),
  everySite: z.array(paramName).max(500),
  sites: z.array(siteRule).max(500),   // superRefine: domains unique
}).strict(),
```

The default is `{ enabled: true, everySite: <curated>, sites: <curated> }`.
Core exports the curated default so "Reset to defaults" and tests use one
owner. The schema rejects unnormalized input. The web editor normalizes before
it saves: trim, lowercase the domain, drop a scheme, `www.`, path, and port.

## Files

### Core

- New `packages/core/src/links/clean-url.ts`: the curated default, the pure
  `cleanUrl(rawUrl, config)` returning `{ url, removed: string[] }`, and
  `loadUrlCleaner(db)`, which reads `linkCleaning` once and returns
  `(rawUrl) => string`.
- `packages/core/src/index.ts`: export what the adapters use.
- `packages/core/src/settings/schema.ts`: the setting and default above.

### API

- `packages/api/src/link-json.ts`: `toLinkJson` and `toTrashLinkJson` take the
  cleaner. `url` is the cleaned URL. Add `originalUrl: string` (raw).
- Every route that builds a `LinkJson` (`grep -rn "toLinkJson(" packages/api/src`)
  loads the cleaner once per request, never per row.
- Search results, feed items, and chat sources that carry a link URL: same
  treatment. Find them with `grep -rn "\.url\b" packages/api/src`.
- New `POST /api/links/clean-preview`, body `{ url }`, returns
  `{ url, originalUrl, removed }` using the saved setting. Same auth and body
  limit as the other link routes. The settings editor uses it for "Try a link".
- New `GET /api/links/clean-defaults` returns the curated `linkCleaning`
  default. "Reset to defaults" PATCHes this value back, so web never copies
  the list.
- `packages/api/src/routes/settings.ts`: a PATCH that carries `linkCleaning`
  uses the 128 KB limit, the same exception `librarianActions` has today. A
  larger body gets the existing 413.

### MCP

- `packages/mcp/server/src/tools/link-shape.ts` and the tools that build link
  output: same rule. `url` is clean, add `originalUrl`. The search text line
  uses the clean URL.

### Web

- `packages/web/src/api/types.ts`: add `originalUrl` to `LinkJson`, and
  `linkCleaning` to `SettingsMap`.
- `packages/web/src/lib/url.ts`: `deriveTitleFromUrl` returns a humanized slug:
  1. Parse the URL. On failure, return the input with the scheme stripped (the
     current behavior).
  2. Take the last non-empty path segment. Decode it. Drop a file extension
     (`.html`, `.htm`, `.php`, `.aspx`).
  3. If the segment has a letter and contains `-` or `_`: replace runs of
     `-`/`_` with one space and uppercase the first character.
  4. Else return host plus path, no query, no hash, no trailing slash.
  5. Path empty: return the host without `www.`.
  The optimistic-capture baseline in `hooks.ts` uses the same function, so the
  title reveal starts from the same text.
- New settings tab "Links" (`SettingsTabs/LinksTab.tsx`), registered beside
  the others:
  - "Clean links" toggle. Helper: "Hides tracking parameters like
    utm_source. Saved links keep the original."
  - "Try a link": a URL field. Shows the cleaned URL and the removed params.
    Calls the preview endpoint.
  - "Every site": the param list as removable chips, with an add field.
    Accepts a comma or space separated paste.
  - "Per site": one row per site with the domain, its strip chips, and its
    keep chips. Add site, edit, and remove.
  - "Reset to defaults", with a confirm step.
  - The lists stay editable while the toggle is off.
  Follow `QuickActionsEditor.tsx` for list editing, `ToggleSwitch.tsx` for the
  toggle, and the Oat tokens for the look.
- Reader overflow menu (`ReaderPane.tsx`) and `RowMenu.tsx`: a "Copy original
  link" item, shown only when `originalUrl !== url`.

## Out of scope

- Reading the page's `rel=canonical` to decide which params matter. Parked.
- Changing dedup or `canonical_url`.
- The ClearURLs catalog, and import or export of rule lists.
- Why bigthink.com returned no title at capture.

## Tests

- `clean-url.test.ts`: each default every-site param stripped; prefix match;
  case-insensitive names; site rule on a subdomain; site rule not applied on
  another host (`si` kept on `example.com`); keep beats every-site strip; keep
  beats site strip; owner-added every-site param stripped; owner-removed
  default param kept; remaining param order kept; `?` dropped when empty; hash
  kept; non-http and malformed input unchanged; disabled returns input;
  `removed` lists what went.
- Settings schema tests: accepts the default; rejects unknown keys, bad param
  names, unnormalized domains, duplicate domains, and over-limit lists.
- `link-json.test.ts`: `url` clean, `originalUrl` raw, leak guard updated.
- Preview route test: cleans with the saved setting; rejects non-http input.
- MCP link-shape test: same as link-json.
- `url.test.ts` in web: the bigthink URL gives `The consciousness theory that
  connects you to everything`; `example.com/?q=1` gives `example.com`;
  `github.com/amitray007/silo` gives `github.com/amitray007/silo`;
  `/post/12345` gives host plus path; malformed input unchanged.
- `LinksTab` test: toggle writes the setting; add and remove an every-site
  param; add, edit, and remove a site rule; domain normalized on save; reset
  restores defaults; preview shows the cleaned URL.

## QA

Against a QA copy of the database and the running app, never the real `silo`
database:

1. Save the bigthink URL above. Title fallback reads as the slug. Open and Copy
   give the URL without `utm_*`. "Copy original link" gives the raw URL.
2. Save a YouTube share link with `?si=`. Served URL has no `si`; `v=` stays.
3. Save `https://www.google.com/search?q=silo`. `q` stays.
4. Add a site rule `example.com` keep `utm_source`. A saved
   `example.com/?utm_source=a&utm_medium=b` serves `?utm_source=a`.
5. Add `ref` to every site. A link with `?ref=x` loses it. Remove it again.
6. Turn cleaning off. Every link serves its raw URL. Turn it on again.
7. Reset to defaults restores the curated lists.
8. MCP `get_link` and `search_links` return the clean `url` and the raw
   `originalUrl`.
9. Run the curated real-site set (see the QA memory note on real links).
