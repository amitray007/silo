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
   - Capture keeps Readability's article HTML. It is sanitized server-side
     (DOMPurify over jsdom: an allowlist of text, heading, list, quote, code,
     pre, table, figure, img, a and inline formatting tags; no style, class or
     id) and stored in a new nullable `links.content_html` column
     (migration `0016`). `extracted_text` stays as the search and MCP source.
   - Extraction fixes: run Readability even when `isProbablyReaderable` says
     no, and use its result when it beats the fallback; normalize lazy images
     before parsing; fall back to the main/article/body text. Compare
     Readability and Defuddle on the QA set and keep the one with better
     results. Record the numbers in the unit report.
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

**Decision (2026-10-25): keep Readability.** Defuddle is not clearly better across
this set. Its Node path recovers the HN opening post, the Linear method index,
and more Cloudflare entries. It returns no RFC text, reduces BBC to a short
fragment, and includes replies in the X result. These tradeoffs do not justify
replacing the current extractor.

Method: fetch each of the 26 URLs once with `safeFetch`, then reuse those exact
responses for every parser run. Redirects follow the production fetch policy.
Twenty-five responses were HTML; the arXiv PDF was excluded from HTML parsing.
Run Readability 0.6.0 and Defuddle 0.19.6 on separate inert jsdom 30.1.1 documents,
with the same image normalization. Also run Defuddle's Node API with its bundled
linkedom adapter and `useAsync: false`; no parser may fetch another page or API.
Lengths are whitespace-normalized JavaScript string lengths (UTF-16 code units),
measured before the Reader sanitizer, HTML cap, embedded JSON recovery, or YouTube
metadata fallback. Inspect each output's prose and opening/closing sections for
main-content presence and navigation/footer leakage. Listing pages are judged
against their entries; the HN page is judged against its post and discussion.

Defuddle on jsdom logged `Selector exceeds maximum allowed length of 2048` and
frequently returned page chrome. The Node/linkedom run avoids using that
compatibility failure as the only basis for the decision. `R` is Readability
with jsdom; `D-J` is Defuddle with jsdom; `D-N` is Defuddle Node/linkedom. Presence
compares R with D-N. A larger length alone does not mean better extraction.

| URL | R chars | D-J chars | D-N chars | Main content R / D-N | Content and junk assessment |
| --- | ---: | ---: | ---: | --- | --- |
| https://paulgraham.com/greatwork.html | 66,518 | 66,518 | 66,721 | yes / yes | Both keep the essay and acknowledgements; no site navigation. |
| https://simonwillison.net/2024/Dec/31/llms-in-2024/ | 40,570 | 42,185 | 39,613 | yes / yes | Both keep the article and its monthly link list; Node drops the date. |
| https://www.joelonsoftware.com/2000/08/09/the-joel-test-12-steps-to-better-code/ | 20,093 | 22,997 | 20,040 | yes / yes | Both keep all 12 steps; no site menu or footer in Node. |
| https://martinfowler.com/articles/microservices.html | 34,044 | 50,584 | 40,800 | yes / yes | Node also keeps article notes and revision history; Readability is shorter. |
| https://en.wikipedia.org/wiki/Hypertext | 30,249 | 37,107 | 26,574 | yes / yes | Both keep article prose; Node moves citations and drops some link sections. |
| https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options | 3,265 | 12,763 | 3,057 | yes / yes | Both keep header guidance; Node drops See also links. |
| https://maggieappleton.com/garden-history | 29,483 | 58,772 | 28,926 | yes / yes | Both keep the essay; Node includes footnotes and image descriptions. |
| https://stephango.com/defuddle | 549 | 682 | 487 | yes / yes | Node drops project resource links; both keep the short article. |
| https://til.simonwillison.net/youtube/fixing-153-embed | 1,370 | 1,504 | 1,413 | yes / yes | Both keep the explanation, code, and edit/history links. |
| https://react.dev/learn | 11,463 | 13,644 | 11,602 | yes / yes | Both keep tutorial prose and examples; no global nav in Node. |
| https://modelcontextprotocol.io/introduction | 1,853 | 3,158 | 2,196 | yes / yes | Both keep the introduction; Node includes more next-step cards. |
| https://linear.app/method | 154 | 898 | 492 | partial / yes | Readability keeps the introduction only; Node also keeps the method index. |
| https://github.com/mozilla/readability | 6,572 | 10,301 | 6,587 | yes / yes | Both keep the README; Node excludes GitHub menus and footer. |
| https://github.com/kepano/defuddle | 11,820 | 15,298 | 11,807 | yes / yes | Both keep the README; Node excludes GitHub menus and footer. |
| https://news.ycombinator.com/item?id=44067409 | 12,858 | 17,109 | 17,109 | partial / yes | Readability starts in comments and misses the opening post; Node keeps post and comment metadata. |
| https://www.youtube.com/watch?v=jNQXAC9IVRw | 0 | 0 | 0 | no / no | Empty static body; neither provides video text or a transcript. |
| https://www.youtube.com/watch?v=aircAruvnKk | 0 | 0 | 0 | no / no | Empty static body; neither provides video text or a transcript. |
| https://youtu.be/zjkBMFhNj_g | 0 | 0 | 0 | no / no | Empty static body after redirect; neither provides a transcript. |
| https://vimeo.com/76979871 | 206 | 206 | 118 | no / no | Both extract a human-verification wall, not video content. |
| https://arxiv.org/abs/1706.03762 | 1,798 | 4,889 | 1,924 | yes / yes | Both keep the abstract and version history; Node also keeps minor utility links. |
| https://arxiv.org/pdf/1706.03762 | 0 | 0 | 0 | N/A / N/A | PDF fetched once; excluded from HTML parsers, lengths shown as 0. |
| https://www.rfc-editor.org/rfc/rfc7034.html | 23,599 | 23,599 | 0 | yes / no | Readability keeps the RFC including page headers; Node returns no text. |
| https://blog.cloudflare.com/ | 1,630 | 7,900 | 4,979 | partial / yes | Listing, not an article: Node keeps more entries; Readability keeps a subset. |
| https://www.bbc.com/news | 7,015 | 8,684 | 375 | yes / partial | Listing: Readability retains many stories plus navigation; Node retains only 375 characters. |
| https://x.com/karpathy/status/1886192184808149383 | 997 | 4,109 | 2,628 | yes / yes | Readability isolates the target post; Node includes replies and engagement counts. |
| https://substack.com/@soamjena/note/c-218382601 | 337 | 322 | 322 | yes / yes | Both keep the note; Node drops the posting timestamp. |

D-J retains navigation/footer text on Simon Willison, Joel, Fowler, Wikipedia,
MDN, Maggie Appleton, Steph Ango, React, MCP, Linear, both GitHub repositories,
arXiv abs, Cloudflare, BBC, and X. R and D-N have the per-page limits noted above.
None of these static parsers overcomes a video shell or a verification wall.
The comparison checks fetched HTML, not authenticated or browser-rendered pages.
The parser interfaces follow the upstream [Readability documentation](https://github.com/mozilla/readability)
and [Defuddle Node documentation](https://github.com/kepano/defuddle#nodejs).

The Reader cap regression uses 12,000 paragraphs (1,284,040 input bytes). A local
run took 521 ms and stored 1,048,512 bytes, below the 1 MiB cap. The test requires
completion within five seconds. This is a local synthetic measurement.

The QA upgrade used only `silo_reader_qa`: 8 upgraded, 0 unchanged, 1 unavailable
(the PDF). It filled missing text and its generated search index only; all
statuses, timestamps, existing Reader HTML/images, and non-empty text stayed the
same. Paul Graham's article now has 66,518 text characters while its status
remains `partial`. YouTube stores its meta description, not a transcript; Vimeo
still contains a verification wall. Existing Reader HTML is preserved by design,
so the upgrade does not rewrite prior image selections or shell captures.

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
