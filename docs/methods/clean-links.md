# Method: clean links

## Goal

A saved link shows, opens, copies, and serves over MCP without marketing query
parameters. A link without a title shows a readable fallback, not the raw URL.

Today a link saved as
`https://bigthink.com/the-well/the-consciousness-theory-that-connects-you-to-everything/?utm_source=x&utm_medium=social&utm_campaign=articles&utm_content=mcgilchrist`
with no title shows that whole string as its title in the reader and the list.
After this change it shows `The consciousness theory that connects you to
everything`, and Open and Copy use the URL without the `utm_*` params.

## Frozen decisions

1. **Clean at read time. Never rewrite stored data.** `links.url` keeps the raw
   URL exactly as captured. The served URL is computed when a link leaves core
   for an adapter. Effect: a wrong rule is fixed by editing the rule, and the
   fix applies to every link. No migration, no backfill, no data loss.
2. **One setting, on by default.** `linkCleaning` holds `enabled` plus
   per-domain `keep` and `strip` rules. Default on is safe because of
   decision 1.
3. **Curated built-in list in code, not the ClearURLs catalog.** The catalog is
   large, regex-heavy, and its 2026 maintenance status is unconfirmed. Parked
   in `future-scope.md`.
4. **Dedup does not change.** `canonicalize` and its conservative list stay as
   they are. Cleaning is a display and serve concern only. Known cost: an
   agent that re-captures a served clean URL can create a duplicate when the
   cleaner stripped a param the dedup list keeps (for example YouTube `si`).
   A duplicate is the harmless failure (see `canonicalize.ts`). Unifying the
   two lists with a canonical backfill is parked.
5. **The API and MCP `url` field becomes the served URL.** A new field
   `originalUrl` always carries the raw URL. Every existing consumer (open,
   copy, domain chip, title fallback, MCP text) gets the clean URL with no
   per-site edit.
6. **Title fallback drops the query and humanizes the slug.** The domain
   already shows under the title, so the fallback is the page name only.

## Rules

`cleanUrl(rawUrl, rules)` is pure and never throws. On a URL that does not
parse as http(s), it returns the input unchanged.

Order of evaluation for each query param on a host:

1. A user `keep` rule for the host matches: keep.
2. A user `strip` rule for the host matches: strip.
3. A built-in domain rule for the host matches: strip.
4. A built-in global rule matches: strip.
5. Otherwise keep.

A rule domain matches the host and its subdomains (`youtube.com` matches
`m.youtube.com`). Param names match case-insensitively. A param entry ending in
`*` is a prefix match (`utm_*`). The cleaner touches only the query. It leaves
scheme, host, path, and hash unchanged, and keeps the remaining params in their
original order.

Built-in global list (strip on every host):
`utm_*`, `fbclid`, `gclid`, `gbraid`, `wbraid`, `dclid`, `msclkid`, `yclid`,
`ttclid`, `twclid`, `li_fat_id`, `igshid`, `igsh`, `mc_cid`, `mc_eid`,
`_hsenc`, `_hsmi`, `__hstc`, `__hssc`, `__hsfp`, `hsCtaTracking`, `mkt_tok`,
`_gl`, `vero_id`, `oly_anon_id`, `oly_enc_id`, `rb_clickid`, `s_cid`,
`wickedid`, `srsltid`.

Built-in domain list:

| Domain | Params |
| --- | --- |
| `youtube.com`, `youtu.be` | `si`, `feature`, `pp` |
| `open.spotify.com` | `si`, `context` |
| `x.com`, `twitter.com` | `s`, `t`, `ref_src`, `ref_url` |
| `instagram.com` | `igsh`, `img_index` |
| `linkedin.com` | `trk`, `trackingId`, `lipi`, `rcm` |
| `reddit.com` | `share_id`, `rdt` |
| `nytimes.com` | `smid`, `smtyp` |
| `medium.com` | `source` |

Each entry is a param that only tracks. When unsure, leave it out: a kept
tracker is harmless, a stripped page-defining param breaks the link.

## Setting

In `packages/core/src/settings/schema.ts`:

```ts
const domainRule = z.object({
  domain: z.string().min(1).max(253),   // lowercased host, no scheme, no path
  params: z.array(z.string().min(1).max(100)).min(1).max(50),
}).strict();

linkCleaning: z.object({
  enabled: z.boolean(),
  keep: z.array(domainRule).max(200),
  strip: z.array(domainRule).max(200),
}).strict(),
```

Default: `{ enabled: true, keep: [], strip: [] }`. Normalize `domain` on write
(trim, lowercase, drop `www.` and any scheme or path) so rules match.

## Files

### Core

- New `packages/core/src/links/clean-url.ts`: the built-in lists, the pure
  `cleanUrl(rawUrl, rules)`, and `loadUrlCleaner(db)`, which reads
  `linkCleaning` once and returns `(rawUrl) => string`. Disabled returns the
  identity function.
- `packages/core/src/index.ts`: export `cleanUrl` and `loadUrlCleaner`.
- `packages/core/src/settings/schema.ts`: the setting and default above.

### API

- `packages/api/src/link-json.ts`: `toLinkJson` and `toTrashLinkJson` take the
  cleaner. `url` is the cleaned URL. Add `originalUrl: string` (raw).
- Every route that builds a `LinkJson` (`grep -rn "toLinkJson(" packages/api/src`)
  loads the cleaner once per request, never per row.
- Search results, feed items, and chat sources that carry a link URL: same
  treatment. Find them with `grep -rn "\.url\b" packages/api/src`.

### MCP

- `packages/mcp/server/src/tools/link-shape.ts` and the tools that build link
  output: same rule. `url` is clean, add `originalUrl`. The search text line
  uses the clean URL.

### Web

- `packages/web/src/api/types.ts`: add `originalUrl` to `LinkJson`.
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
- `packages/web/src/components/SettingsTabs/PreferencesTab.tsx`: a "Clean
  links" toggle row, and below it a rules editor: one row per rule with domain,
  a Keep/Strip select, params as comma-separated text, and remove. An Add rule
  button. Follow `QuickActionsEditor.tsx` for list editing and
  `ToggleSwitch.tsx` for the toggle. Helper copy under the toggle: "Hides
  tracking parameters like utm_source. Saved links keep the original."
- Reader overflow menu (`ReaderPane.tsx`) and `RowMenu.tsx`: a "Copy original
  link" item, shown only when `originalUrl !== url`.

## Out of scope

- Reading the page's `rel=canonical` to decide which params matter. Next slice:
  enrichment stores the page canonical, and the cleaner keeps a param the page
  canonical keeps. Park it.
- Changing dedup or `canonical_url`.
- The ClearURLs catalog.
- Why bigthink.com returned no title at capture.

## Tests

- `clean-url.test.ts`: each built-in global param stripped; prefix match;
  case-insensitive names; domain rule on subdomain; domain rule not applied on
  another host (`si` kept on `example.com`); user keep beats built-in strip;
  user strip on a domain; remaining param order kept; hash kept; non-http input
  and malformed input returned unchanged; disabled setting returns identity.
- Settings schema tests: accepts the default, rejects unknown keys, bounds.
- `link-json.test.ts`: `url` clean, `originalUrl` raw, leak guard updated.
- MCP link-shape test: same.
- `url.test.ts` in web: the bigthink URL gives `The consciousness theory that
  connects you to everything`; `example.com/?q=1` gives `example.com`;
  `github.com/amitray007/silo` gives `github.com/amitray007/silo`;
  `/post/12345` gives host plus path; malformed input unchanged.
- PreferencesTab test: toggle writes the setting; add, edit, and remove a rule.

## QA

Against a real Postgres and the running app:

1. Save the bigthink URL above. Title fallback reads as the slug. Open and Copy
   give the URL without `utm_*`. "Copy original link" gives the raw URL.
2. Save a YouTube share link with `?si=`. Served URL has no `si`; `v=` stays.
3. Save `https://www.google.com/search?q=silo`. `q` stays.
4. Add a keep rule `example.com: ref`. A saved `example.com/?ref=a&utm_source=b`
   serves `?ref=a`.
5. Turn cleaning off. Every link serves its raw URL. Turn it on again.
6. MCP `get_link` and `search_links` return the clean `url` and the raw
   `originalUrl`.
7. QA list: the curated real-site set (see memory note on real links).
