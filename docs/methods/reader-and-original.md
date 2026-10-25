# Method: a real Reader and an Original view that works for any site

**Why:** On 26 real links, the Original tab was blank for 15 sites because they
block framing (GitHub, MDN, YouTube, X, BBC, arXiv, Vimeo, MCP docs). The Reader
showed plain paragraphs, and 9 links had no text at all (paulgraham.com, the MCP
docs, linear.app, every YouTube link, Vimeo, the arXiv PDF). Amit asked for a
Reader and an Original view that work for any website, with videos playing
inside silo.
**Decision (Amit, 2026-10-25):** Original fetches the page live when you open
it. Silo stores nothing for it, so the "not an archive" rule in
`docs/product/scope.html` holds.
**Branch:** `feat/reader-original`, stacked on `feat/three-pane-redesign`
(PR #92). Worktree `.claude/worktrees/reader-original`.
**Builder:** Codex Sol (`gpt-6.1-sol`, priority tier), by Amit's direction.
**Rules:** `docs/rules/` (architecture, typescript, api-hono, db-drizzle,
web-react, testing). `exactOptionalPropertyTypes` is on.

## QA set (binding)

Test with real links, never the dummy `example.com` rows. The set lives in
`docs/methods/reader-and-original.qa-links.txt` (26 URLs: long articles, docs,
Wikipedia, GitHub, HN, YouTube x3, Vimeo, X, arXiv abs + PDF, BBC, Substack,
linear.app). The local QA database is `silo_reader_qa`. Each unit reports a
per-URL table: capture status, text length, Reader result, Original mode.

## Frozen decisions

1. **Original view, in this order:**
   1. **Player embed** when the URL matches a known provider (decision 4).
   2. **Direct iframe** when the page allows framing (no `X-Frame-Options`, and
      no CSP `frame-ancestors` that excludes silo). Full interactivity.
   3. **Silo view:** a live, script-free copy fetched by the server on request
      and shown in a sandboxed iframe (decision 2). Nothing is stored.
   4. **Card** with "Open in new tab" when the fetch fails or the content is not
      HTML and cannot be framed.
   The tab header shows which mode is active and always offers "Open in new
   tab". When a direct iframe is in use, offer "Show silo view" as a manual
   switch, because some sites frame but render blank.
2. **Silo view: the live page proxy.**
   - Route: `GET /api/links/:id/view` returns HTML. It fetches only the link's
     own stored URL, never a client-supplied URL, like `preview-image`.
   - Route: `GET /api/links/:id/frame` returns
     `{ mode: 'direct' | 'view' | 'none', reason?: string, contentType?: string }`
     from the same fetch. `/frame` is a hint, not a guarantee, so the manual
     "Show silo view" switch stays.
   - **Architecture:** the API must not import the worker. Follow the enqueuer
     precedent (`packages/core/src/links/enqueue.ts`): `@silo/core` defines a
     `PageViewer` port with a setter; `@silo/worker` implements it with its
     `safeFetch` (SSRF guards, DNS pinning, redirect revalidation, 5 MB cap,
     timeout); `@silo/app` registers it at startup. Registration is
     process-local: an API process with no viewer returns 503 and Original
     falls back to the card. Document this.
   - **Policy headers:** `safeFetch` must keep the final response's
     `X-Frame-Options` and enforced `Content-Security-Policy` headers (today it
     drops them). Rule: an enforced `frame-ancestors` (any policy, with
     wildcard, scheme and port matching against silo's origin) overrides XFO;
     ignore report-only and `<meta>` `frame-ancestors`; any `DENY` or
     `SAMEORIGIN` among duplicate XFO values blocks; `ALLOW-FROM` blocks.
   - **Load limits:** coalesce concurrent requests for the same link; at most
     2 page views in flight (others wait briefly, then 503); abort the fetch
     when the client disconnects; cache transformed output under a total byte
     budget (32 MB) with a 10-minute TTL. Run parsing and the transform in a
     `worker_threads` pool with a hard time limit (for example 3 s) so a large
     page cannot block the API event loop; close every DOM window.
   - **Transform:** parse; unwrap `noscript`; copy lazy-load attributes
     (`data-src`, `data-srcset`, `data-lazy-src`) into `src`/`srcset`; resolve
     every URL against the final URL explicitly (no `<base>`); then sanitize
     the **final** DOM with an explicit allowlist (DOMPurify, whole document):
     keep layout, text, media, `img`, `picture`/`source`, `video`/`audio`
     posters, `style` elements, `link rel="stylesheet"` and the `style`
     attribute; drop scripts, all `on*` attributes, `iframe`, `frame`,
     `object`, `embed`, `form` and form controls' submit behavior, `template`,
     SVG `foreignObject`, MathML, `meta` other than charset and viewport,
     `ping`, `download`, and any URL that is not `http(s):` or `data:` (images
     only). Anchors get absolute `http(s)` URLs, `target="_blank"` and
     `rel="noopener noreferrer"`.
   - **Response headers:** `Content-Security-Policy: sandbox
     allow-popups allow-popups-to-escape-sandbox; default-src 'none';
     script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none';
     form-action 'none'; base-uri 'none'; img-src * data:; style-src *
     'unsafe-inline'; font-src * data:; media-src *; frame-ancestors 'self'`,
     plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
     `Cache-Control: private, no-store`.
   - **Web iframe:** `sandbox="allow-popups allow-popups-to-escape-sandbox"`
     (no `allow-scripts`, `allow-same-origin` or `allow-forms`).
   - **What this guarantees, stated precisely:** the served page cannot run
     script and cannot read silo's cookies, storage or DOM, even when opened
     top-level. It can still make plain GET requests for CSS, images and fonts
     to any host, and links it opens in a new tab are ordinary pages. Silo's
     unsafe API calls stay protected by the CSRF header. Stylesheets and
     images load live from the original site; that is the price of seeing the
     real look, and it only happens when you open Original.
   - **Cross-browser proof:** run the sandbox tests (no script, no cookie
     access, no `fetch`, popups, top-level open) in Chromium, Firefox and
     WebKit (Playwright).
3. **Reader content.**
   - Capture keeps Defuddle's article HTML. It is sanitized server-side
     (DOMPurify over jsdom: an allowlist of text, heading, list, quote, code,
     pre, table, figure, img, a and inline formatting tags; no style or class;
     only generated footnote IDs) and stored in a new nullable `links.content_html` column
     (migration `0016`). `extracted_text` stays as the search and MCP source.
   - Extraction uses Defuddle 0.19.6 over linkedom after jsdom normalization,
     with async/network extraction disabled and a hard worker-thread timeout.
     See the updated extractor decision and cache results below.
   - YouTube: store `videoId` in `sourceData`, and use the page's meta
     description as text when there is no transcript.
   - The API returns `contentHtml` only from `GET /api/links/:id`, never in
     list payloads.
   - **Reader images:** the sanitizer resolves each image URL against the
     final URL, canonicalizes it once, strips `srcset`, and stores the ordered
     list in a new `links.content_images` jsonb column. The web rewrites each
     `img` to `GET /api/links/:id/content-image/<index>`; the client never sends
     a URL. Reuse `preview-image`'s SSRF-safe image fetch (raster MIME
     allowlist, nosniff) and move its DNS lookup inside the timeout.
   - **Web:** render `contentHtml` through DOMPurify again (defense in depth)
     into a styled prose container: headings, lists, quotes, code blocks with
     horizontal scroll, tables, images capped to the column width, and links
     opening in a new tab with `rel="noopener noreferrer"`. Fall back to the
     current text paragraphs when `contentHtml` is null.
   - **Upgrading existing links:** "Retry capture" skips `full` links and the
     enricher trashes links on 404/410, so neither is safe for a bulk upgrade.
     Add a separate, resumable "reader upgrade" job (and a command such as
     `pnpm --filter @silo/app reader-upgrade`) for live links of any status.
     It fills missing `content_html`/`content_images` and null or empty
     `extracted_text`, preserves non-empty text and status, keeps existing data
     on failure, and never trashes. Cap stored HTML (for example
     1 MB) by dropping trailing blocks, never by cutting markup.
4. **Player embeds.** A pure web function `embedFor(url, sourceData)` returns
   `{ provider, src, aspect }` from URL patterns. It never uses provider-
   supplied HTML.
   - YouTube (`watch`, `youtu.be`, `shorts`, `embed`, `live`):
     `https://www.youtube-nocookie.com/embed/<id>`; convert `t=` (`90`, `1m30s`)
     to integer `start` seconds.
   - Vimeo: `https://player.vimeo.com/video/<id>`, carrying the unlisted
     `h=<hash>` from `vimeo.com/<id>/<hash>` URLs.
   - X/Twitter status: `https://platform.twitter.com/embed/Tweet.html?id=<id>`
     with the current theme; keep the tweet card fallback because anonymous
     rendering is not guaranteed.
   - Loom (`/share/<id>` to `/embed/<id>`, 4:3), Spotify
     (`open.spotify.com/<type>/<id>` to `/embed/<type>/<id>` for track, album,
     playlist, episode, show; playback may be preview-only), CodePen (`/pen/`
     to `/embed/`), Figma (`https://embed.figma.com/...` with `embed-host=silo`,
     per Figma's current embed docs).
   - Validate host and id shape with allowlists; anything else is not an
     embed. Each player iframe gets a `title` and provider-specific height or
     aspect. Players do not use the silo-view sandbox.
   - Player iframes use `referrerpolicy="strict-origin-when-cross-origin"`
     (YouTube error 153 happens with `no-referrer`),
     `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`,
     `allowfullscreen`, and the provider's aspect ratio.
   - **Videos play in the Reader too:** for video providers the Reader shows
     the player above the title, then the description text.
5. **Scope update.** Move "in-silo reader" from Later to Now in
   `docs/product/scope.html`. In the anti-scope, say that silo stores the
   readable article HTML (like extracted text) but never a page copy, and that
   the Original view is a best-effort live fetch: some sites will still show
   only a card.

## Units (one commit each; the lead reviews between units)

Order ships the Reader and players before the riskier live proxy.

### Unit 1 - Reader capture (db, core, worker, api)
Decision 3 except the web part: migration `0016` (`content_html`,
`content_images`, both nullable), extraction fixes and the
Readability/Defuddle comparison, sanitizer, YouTube `videoId`, `contentHtml`
and image count in the detail API only, the content-image route, the reader
upgrade job. Tests: sanitizer strips scripts, handlers, `javascript:` URLs,
styles and iframes; extraction fixtures for a table-layout page
(paulgraham.com shape), a lazy-image page and a page Readability rejects; the
image route refuses an index out of range and non-raster responses; list
payloads carry no `contentHtml`; the upgrade job never trashes and keeps data
on failure. Run the migration on `silo_reader_qa`, run the upgrade on the QA
set, and report the per-URL table.

### Unit 2 - Web Reader and players
Decision 3 (web part) and decision 4, plus Original modes 1, 2 and 4. Until
unit 3 adds `/frame`, Original shows the player when there is one, else the
direct iframe with the current "Blank page?" hint and the card as fallback. `embedFor` table tests
for every provider pattern and non-matches; the prose renderer with
DOMPurify; image rewriting by index; players in the Reader for video links.
Browser QA on all 26 QA links at 1440 and 390 in both themes.

### Unit 3 - Silo view (core port, worker viewer, api routes, app wiring, web)
Decision 2 and Original mode 3, with the full mode order from decision 1.
Tests: transform fixtures with XSS payloads (`<script>`, `onerror`,
`javascript:` and entity/control-character URLs, mixed-case `meta`
refresh/CSP, `<base>`, `srcdoc`, SVG with script and `foreignObject`, MathML,
namespace attributes, multi-token `rel`); exact security headers; `/frame`
modes for every policy-header case in decision 2; coalescing, concurrency,
byte budget, worker-thread timeout and disconnect abort; 503 with no viewer;
the cross-browser sandbox proof. Then report the Original mode for every QA
URL with curl and in the browser.

## Done for each unit

1. `pnpm turbo run check-types test` for the touched packages, plus
   `pnpm quality` and `pnpm --filter @silo/web build`. DB-backed suites run
   against local Postgres (`DATABASE_URL=postgres://maverick@localhost:5432/...`);
   report unrelated failures, do not fix them.
2. One commit per unit, staged by explicit path, ending with
   `Co-Authored-By: Claude <noreply@anthropic.com>`.
3. Report: SHA, files, checks, the per-URL table, and anything not done.

## Extractor comparison (Unit 1)

**Decision (2026-10-25): replace Readability with Defuddle 0.19.6 (MIT),
using linkedom (ISC) after inert jsdom parsing and serialization.** This
supersedes the initial comparison. The hybrid DOM path fixes the RFC failure
seen with linkedom alone. Defuddle on jsdom directly hits
`Selector exceeds maximum allowed length of 2048`.

On the 26 QA URLs, the research comparison judged Defuddle better on six:
React code blocks and duplicate light/dark images, Wikipedia headings,
Fowler footnotes, HN opening post plus comments, MCP navigation removal, and
Cloudflare listing coverage. It lost on three: BBC's short listing fragment,
Maggie Appleton's four embedded tweets, and X replies/counts. The remaining
URLs tied. Trafilatura was rejected because it breaks code/headings and needs
a Python sidecar. Length alone does not measure extraction quality.

Defuddle is pre-1.0. Pin `0.19.6` exactly and rerun this cache comparison before
upgrading. It runs with `useAsync: false` and a throwing `fetch` override.
Metadata still comes from metascraper; challenge detection, YouTube player
JSON, and embedded-JSON recovery stay in place. Search text comes from
Defuddle content before the stored HTML cap. DOMPurify, the tag/attribute
allowlist, URL checks, ordered image targets, and `capHtml` remain. A small
sanitizer adapter chooses one URL for srcset-only images, then strips srcset.

**Review fixes (2026-10-26):** parsing, Defuddle, recovery, and sanitization
share one reusable worker thread with a FIFO queue. Fetch jobs stay concurrent;
CPU extraction is serialized to avoid cold-start contention on small hosts.
The **five-second page deadline starts only after the ready handshake**, when
the page is sent to the thread. Startup has a separate 30-second deadline.
A failed or timed-out thread is terminated and awaited before its replacement
handles the next queued page. Idle threads are unreferenced; worker shutdown
closes the pool after in-flight enrichment jobs finish. Each thread retains
the 256 MiB V8 old-generation limit.

Timeout and thread failures log their reason and throw `ReaderExtractionError`.
`enrichLink` propagates that error to pg-boss's existing retry/backoff and
dead-letter path instead of recording a successful metadata-only capture.
This contains the synchronous hang reported in
[Defuddle issue 447](https://github.com/kepano/defuddle/issues/447).
Tests cover slow startup, ten queued pages, thread reuse, termination,
replacement, exit recovery, shutdown, and the enrichment rejection path.

The thread imports `@silo/core/capture`, a pure public entry for capture
contracts and URL classification. It never imports the database barrel or
constructs a Postgres pool. A real-thread test removes `DATABASE_URL` and
checks the full extraction path. Challenge detection takes precedence over
SPA-shell classification. YouTube player titles take precedence over
metascraper titles, as before the Defuddle change.

The input gets one jsdom document. The sanitizer and YouTube path reuse that
window. Our Readability/fallback clones, challenge-page clone, sanitizer's
second window, and spacer-template reparse are gone. Defuddle owns lazy-image,
layout-table, and small-image cleanup. `normalizeLazyImages`,
`unwrapLayoutTables`, and `withoutSpacers` remain deleted. Defuddle can retain
a decorative GIF whose dimensions are unknown; we no longer guess from
filenames. Layout tests assert reading order, prose, data-cell values, and
meaningful images through the extractor. Srcset candidates are split at
width/density descriptors, preserving commas inside Substack/CDN URLs.

The old generic Reader HTML fallback remains deleted. A minimal search-text
guard runs only when Defuddle returns fewer than 1,000 characters and the
body-minus-chrome text is at least five times longer and at least 200
characters. It strips scripts, styles, navigation, headers, footers, sidebars,
noscript, templates, and explicitly hidden elements. It changes only search
text and capture status, never Reader HTML or its image list. Embedded-JSON
article recovery takes precedence. This is static text recovery, not a full
visibility calculation; publisher CSS can hide other text.

A database-free rerun of all 26 cached responses kept the same Reader HTML
metrics below. BBC still has 500 Reader characters, but its search text now
contains 6,540 characters. A separate cached response of
`https://paulgraham.com/hwh.html` returned 18,019 text characters in every
request. On this Mac, fresh-pool batches of 1, 5, and 10 requests completed in
1,240, 967, and 1,240 ms; the next warm page took 60, 48, and 45 ms. These are
local measurements, not a 1-vCPU deployment benchmark. No request timed out.

The lead's QA database copy is `silo_reader_qa`. This fix used cached pages and
disposable test databases only. It did not run `reader-upgrade`; refresh and
backfill remain with the lead.

Footnote targets and references matching `fn:*`/`fnref:*` get generated
`silo-fn-<number>` IDs. All other publisher IDs and duplicate IDs are removed.
Matching links remain local fragments without a new-tab target. The web's
second sanitizer accepts only these generated IDs and links. Tests cover
forward links, backlinks, duplicate IDs, and DOM-clobbering names.

Cheap option checks on Maggie Appleton tried `removeExactSelectors`,
`removePartialSelectors`, `removeLowScoring`, `removeContentPatterns`,
`standardize`, and `includeReplies`. Only `removeLowScoring: false` restored
all four tweets. A run across the cache also restored Simon Willison's site
navigation and year archive, so defaults remain. BBC's 500-character Reader
fragment remains; the search-text guard recovers its listing text without a
site-specific rule. X replies/counts remain.

### Cached production-pipeline comparison

Run both revisions on the same `/tmp/silo-reader-research/cache/manifest.json`
responses, using each response's final URL and content type. This run used no
database and did not run `reader-upgrade`. All 25 HTML responses went through
the full production pipeline; the PDF exercised the non-HTML guard. These
are fetched-page results, not browser-rendered or authenticated-page proof.

Each cell is **Readability pipeline / Defuddle pipeline**. Chars are
whitespace-normalized UTF-16 text lengths from stored Reader HTML after
sanitization and the byte cap; headings count h1-h6; code counts pre blocks;
images count stored proxy targets. YouTube retains descriptions and Vimeo
retains metadata in both pipelines. Output snippets and structure were inspected
for article presence and navigation/footer leakage.

| URL | Chars R / D | Headings R / D | Code R / D | Images R / D | Content and leaks |
| --- | ---: | ---: | ---: | ---: | --- |
| https://paulgraham.com/greatwork.html | 66,518 / 66,721 | 0 / 0 | 0 / 0 | 1 / 0 | Essay and acknowledgements kept; no navigation. |
| https://simonwillison.net/2024/Dec/31/llms-in-2024/ | 40,472 / 39,515 | 20 / 20 | 1 / 1 | 4 / 3 | Article and monthly list kept; date omitted. |
| https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/ | 20,093 / 20,040 | 0 / 0 | 0 / 0 | 0 / 0 | All 12 steps kept; no site menu. |
| https://martinfowler.com/articles/microservices.html | 34,044 / 40,800 | 11 / 13 | 0 / 0 | 6 / 7 | Footnotes and revision history recovered; backlinks work. |
| https://en.wikipedia.org/wiki/Hypertext | 30,249 / 26,574 | 3 / 7 | 0 / 0 | 9 / 6 | Heading hierarchy and footnotes retained; link sections shorter. |
| https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options | 3,265 / 3,057 | 11 / 9 | 9 / 9 | 0 / 0 | Guidance kept; compatibility badge remains; See also omitted. |
| https://maggieappleton.com/garden-history | 29,483 / 28,926 | 15 / 15 | 0 / 0 | 18 / 18 | Four embedded tweets lost; footnotes kept; empty Table of Contents label remains. |
| https://stephango.com/defuddle | 549 / 487 | 1 / 1 | 0 / 0 | 0 / 0 | Short article kept; resource links omitted. |
| https://til.simonwillison.net/youtube/fixing-153-embed | 1,370 / 1,413 | 0 / 1 | 4 / 4 | 1 / 1 | Explanation and code kept; edit/history utility links remain. |
| https://react.dev/learn | 11,463 / 11,602 | 12 / 12 | 24 / 24 | 8 / 4 | Code formatting restored; duplicate light/dark images removed. |
| https://modelcontextprotocol.io/introduction | 1,853 / 2,196 | 6 / 12 | 0 / 0 | 0 / 1 | Navigation leak removed; next-step cards retained. |
| https://linear.app/method | 476 / 492 | 1 / 1 | 0 / 0 | 0 / 0 | Method index retained. |
| https://github.com/mozilla/readability | 6,572 / 6,587 | 10 / 11 | 6 / 6 | 0 / 0 | README kept; no GitHub menus. |
| https://github.com/kepano/defuddle | 11,820 / 11,807 | 24 / 24 | 18 / 18 | 0 / 0 | README kept; no GitHub menus. |
| https://news.ycombinator.com/item?id=44067409 | 12,858 / 17,109 | 0 / 1 | 2 / 2 | 0 / 0 | Opening post recovered with discussion; comment authors/dates retained. |
| https://www.youtube.com/watch?v=jNQXAC9IVRw | 256 / 256 | 0 / 0 | 0 / 0 | 0 / 0 | Description only; no transcript; player extraction unchanged. |
| https://www.youtube.com/watch?v=aircAruvnKk | 3,337 / 3,337 | 0 / 0 | 0 / 0 | 0 / 0 | Description only; no transcript; player extraction unchanged. |
| https://youtu.be/zjkBMFhNj_g | 3,802 / 3,802 | 0 / 0 | 0 / 0 | 0 / 0 | Description only; no transcript; player extraction unchanged. |
| https://vimeo.com/76979871 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | Verification wall rejected; metadata retained. |
| https://arxiv.org/abs/1706.03762 | 1,793 / 1,924 | 1 / 3 | 0 / 0 | 0 / 0 | Abstract and versions kept; minor utility links remain. |
| https://arxiv.org/pdf/1706.03762 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | PDF guard; no HTML parsing. |
| https://www.rfc-editor.org/rfc/rfc7034.html | 23,599 / 23,105 | 0 / 0 | 14 / 14 | 0 / 0 | RFC recovered by jsdom normalization; RFC page headers remain. |
| https://blog.cloudflare.com/ | 1,630 / 4,979 | 6 / 19 | 0 / 0 | 0 / 0 | More listing entries retained. |
| https://www.bbc.com/news | 6,729 / 500 | 51 / 6 | 0 / 0 | 42 / 2 | Reader keeps a short More to explore/Most watched fragment; search text recovers 6,540 characters. |
| https://x.com/karpathy/status/1886192184808149383 | 997 / 2,628 | 0 / 2 | 0 / 0 | 1 / 0 | Target post plus replies and engagement counts. |
| https://substack.com/@soamjena/note/c-218382601 | 337 / 322 | 0 / 0 | 0 / 0 | 1 / 0 | Note kept; timestamp omitted. |

## Running Original (Unit 3)

Run the HTTP process through `@silo/app` (`pnpm --filter @silo/app start:api`).
It registers the process-local `PageViewer` before accepting requests, even if
queue startup fails. Running `@silo/api` alone does not register a viewer:
`/frame` and `/view` return 503 and the web shows a link card.

The viewer keeps up to 32 MiB of encoded output in memory for ten minutes.
It never writes a page copy to the database or disk. Two fetch/transform jobs
can run at once; other links wait up to one second in a bounded queue. Closing
Original aborts its request. A shared fetch stops when its last client leaves.
The transform pool terminates a job after three seconds, including startup.

Run the separate browser sandbox proof with:

```sh
pnpm exec playwright install chromium firefox webkit
pnpm test:view-sandbox
```

This test is outside the default `test` script. It starts a local fixture server,
uses the production transform and response headers, and closes every browser
and the server. It checks script execution, cookie/storage/parent access,
blocked fetches, ordinary popups with no opener, and top-level isolation in all
three engines. On macOS, it gives Firefox separate test app metadata to avoid
accessing the user's Firefox data ([upstream issue](https://github.com/microsoft/playwright/issues/42768)).
The fixture checks are separate from real-link QA.

Silo view allows live GET requests for CSS, images, fonts, and media. Links open
ordinary pages in new tabs. Its iframe and response CSP omit scripts, same-origin
access, and forms. Unsafe silo API calls still require the CSRF header.
Frame hints use `SILO_PUBLIC_API_URL`'s origin when configured, otherwise the
request URL's origin. Set this public HTTPS URL behind a TLS-terminating
reverse proxy. Frame hints ignore forwarded headers. Vite preserves the
browser Host for local QA.
