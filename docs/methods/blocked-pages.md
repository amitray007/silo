# Blocked and paywalled pages

Some saved pages show no Reader and no Live page: Big Think, The Atlantic,
and other sites behind a bot check or a paywall. Silo must keep whatever text
it can get, say plainly why the rest is missing, and use other legitimate
sources when the page itself refuses Silo. Amit approved the three slices on
2026-11-06. Each slice is one stacked PR.

## Evidence (2026-11-06)

- `curl` with Silo's user agent and with a Chrome user agent: both sites
  return HTTP 403 from Cloudflare. Big Think serves "Just a moment..."
  (`cf-mitigated: challenge`). The Atlantic serves "Your access has been
  blocked". So the main failure is a **bot check**, not a paywall.
- Capture: `enrichFullLink` (`packages/worker/src/enrich.ts`) stops at the
  failed fetch. It maps `http-error` to `bare` and never calls
  `recordReader` or the headless browser. The Reader says "No text to read".
- Live tab: both sites send `X-Frame-Options: SAMEORIGIN`, so the Live tab
  must proxy the page through `safeFetch`, which gets the same 403. It shows
  "Silo could not load this page."
- Headless Chromium (Playwright, local Mac) passed both checks. Big Think
  gave the full article (about 24k characters). The Atlantic showed about
  2k characters after its scripts ran; the HTML the server sent held about
  11k. Its JSON-LD marks the body as paid:
  `"hasPart": {"@type": "WebPageElement", "isAccessibleForFree": false, "cssSelector": ".article-content-body"}`.
- RSS: `https://bigthink.com/feed/` and `https://www.theatlantic.com/feed/all/`
  return 200. Big Think puts long HTML in `<description>` for some posts;
  The Atlantic's Atom `<content>` holds 7-22 KB per entry.
- The Wayback availability API (`https://archive.org/wayback/available?url=`)
  answers for both sites.

## Rules for every slice

- Never spoof a crawler (Googlebot) and never ship paywall-bypass logic.
  GitHub removed Bypass Paywalls Clean and its forks in August 2024 after a
  17 USC 1201 notice. Silo reads only what a site sends to an ordinary
  anonymous visitor, or what the user's own browser shows them.
- Every outbound request goes through `safeFetch` (SSRF guard, size and time
  limits), including feed and archive requests.
- A fallback never blocks or fails a capture. Each one degrades to "no
  Reader from this source" and logs the reason.
- `recordReader` stays the only writer of Reader columns.

## Slice 1: detect, keep, label

### Data

Migration `0033` adds one nullable enum column to `links`:

- `reader_access reader_access` with values `paywalled` and `blocked`.
  `null` means no known restriction.

| Value | Meaning | Reader content |
| --- | --- | --- |
| `null` | Page read normally | Whatever extraction found |
| `paywalled` | The page declares paid content | The free part Silo extracted, if any |
| `blocked` | The site refused Silo: a bot check or HTTP 401/403/429 | Unchanged (none, or an earlier Reader) |

### Detection (worker, pure functions in `packages/worker/src/extract/access.ts`)

- `paywallDeclared(document)`: true when any JSON-LD object (including
  `@graph` members and `hasPart` entries) has `isAccessibleForFree` equal to
  `false` or `"false"`. This is Google's paywalled-content markup; it is
  publisher-declared, so absence proves nothing. Read it from the same parsed
  document that extraction already builds; do not parse the HTML twice.
- `blockedFetch(result)`: true for a `safeFetch` failure with reason
  `http-error` and status 401, 403 or 429, or status 503 with the header
  `cf-mitigated: challenge`. Ask `safeFetch` for that header through its
  existing `responseHeaderNames` option.
- A successful fetch whose page `isChallengePage` is also `blocked`.

### Write path

- Extend `ReaderExtraction` with an optional `access?: 'paywalled' | 'blocked'`
  on `reader` and `no_reader`, and allow `{ status: 'fetch_failed', access: 'blocked' }`.
- `recordReader` writes `reader_access` with the Reader columns. For
  `fetch_failed` with `access: 'blocked'` it writes only `reader_access` and
  keeps every Reader column. A plain `fetch_failed` still writes nothing.
  A later successful read sets the value again (`null` or `paywalled`).
- `enrichFullLink`: on a blocked fetch, call `recordReader` with the blocked
  result before `recordThenMaybeSettle`. Capture status mapping stays as it
  is (`bare`/`partial`), so retry behavior does not change.
- Capture, refresh (`refresh-reader.ts`) and the live Reader
  (`live-reader.ts`) all report access the same way. Put the mapping in one
  helper; do not repeat it per path.
- Fix: a challenge page must not supply title, description or image. Today
  `pageResult` keeps metascraper fields from "Just a moment..." pages. Drop
  them when `page.challenge` is true.

### API and MCP

- `LinkJson` (core serializer, API, web types) gains
  `readerAccess: 'paywalled' | 'blocked' | null`.
- MCP `get_link` returns `readerAccess` and its tool description says what
  each value means for the text the agent receives ("paywalled: the text is
  only the free part").
- The Live tab frame hint: a blocked `safeFetch` result returns
  `{ mode: 'none', reason: 'blocked' }` instead of the generic fetch reason.

### Web

Copy is plain and short. Keep the Oat tokens and the existing
`silo-reader-empty` and `silo-original-card` components; add no new visual
system.

- **Reader with text, `paywalled`:** a one-line notice above the article:
  "Subscriber article. Silo saved the part the site shows to everyone."
  with an "Open original" link.
- **Reader with no text, `paywalled`:** empty state title
  "Behind a paywall", body "The site shows this article to subscribers only.
  Silo saved its details." Actions: Open original, Retry capture.
- **Reader with no text, `blocked`:** title "Blocked by the site", body
  "This site stopped Silo with a bot check. Silo saved the link and its
  details." Actions: Open original, Retry capture.
- **Live tab, reason `blocked`:** "This site blocks automated readers. Open
  it in your browser."
- The list row stays as it is (no new badge), per the design rule that
  healthy rows carry no badge. This slice adds no list-level label.

### Acceptance

- Unit: `paywallDeclared` on fixtures for top-level, `@graph`, `hasPart`,
  string `"false"`, absent markup, and malformed JSON-LD (ignored, no throw).
- Unit: `blockedFetch` for 401/403/429, 503 with and without the header, and
  404 (not blocked; still trashed by the existing rule).
- Integration (real Postgres): blocked capture writes `reader_access =
  'blocked'` and keeps an existing Reader; a later good read clears it;
  plain `fetch_failed` writes nothing; a challenge page stores no
  "Just a moment" title.
- QA: capture a Big Think and an Atlantic article on a QA database. Both show
  "Blocked by the site" (or a Reader, if this machine's IP passes). A local
  fixture page with `isAccessibleForFree: false` shows the notice above its
  text. MCP `get_link` returns `readerAccess`.

## Slice 2: other sources

When the page fetch is blocked, or the Reader is missing, try these in order
and stop at the first Reader that passes the existing quality checks:

1. **Headless browser.** `selectReader` today runs only after a successful
   fetch. On a blocked fetch, call `renderReader(url)` when
   `SILO_BROWSER_WS_ENDPOINT` is set. Reject a `challenge` result as today.
   Take title, description and image from the rendered page when the fetch
   gave none.
2. **The site's feed.** Find the feed with the existing
   `feeds/resolve.ts` suffix probe (the page HTML is not available). Parse it
   with `feeds/parse.ts`. Match the entry whose link equals the saved URL
   after canonicalization (drop `utm_*`, fragment, trailing slash). Use its
   `content:encoded`, Atom `content`, or `description` when it holds at least
   `FULL_TEXT_THRESHOLD` characters of text. Build the Reader by running the
   entry HTML through the normal extraction and sanitizer, wrapped in a
   minimal document with the entry title.
3. **Internet Archive.** Query the availability API. Fetch the closest
   snapshot in raw form (`https://web.archive.org/web/<timestamp>id_/<url>`),
   extract it, and reject a challenge or paywall-empty result.

Data: migration `0034` adds `reader_source` (`page`, `browser`, `feed`,
`archive`, nullable; `null` on old rows means `page`) plus
`reader_source_at` for an archive snapshot date. `recordReader` writes both.

Web: a quiet source line under the article meta: "From the site's RSS feed"
or "From the Internet Archive, snapshot of 3 Nov 2026" with a link to the
snapshot. The `blocked` empty state appears only when every source failed.

Rate and cost: at most one feed probe and one archive request per capture;
cache a host's feed URL (or its absence) in memory for an hour. Archive
requests send Silo's user agent.

Acceptance: unit tests with recorded feed and archive fixtures (no network in
tests); integration test that a blocked capture with a matching feed entry
stores a `feed` Reader; QA on Big Think and The Atlantic articles on the QA
database, recording which source won for each.

## Slice 3: the page from the user's browser

The extension sends the page the user is looking at, so subscriber and
bot-checked pages save in full.

### Extension (`extensions/chrome`)

- On every capture trigger, start two things at the same moment:
  `POST /api/links` with the URL (unchanged), and
  `chrome.scripting.executeScript` on the tab that returns
  `{ url: location.href, html: document.documentElement.outerHTML, capturedAt }`.
  `activeTab` already covers all three triggers. Reading the page takes well
  under a second, so closing the tab right after the toast is safe.
- Skip the page copy when the HTML is larger than 8 MB, or when the tab URL
  no longer equals the captured URL.
- After both finish, put `{ linkId, url, html, capturedAt, attempts }` in an
  IndexedDB outbox, then upload it. Remove the entry on success or on a 4xx
  answer other than 408/429.
- Retry the outbox on service-worker start (`runtime.onStartup`,
  `runtime.onInstalled`), on each new capture, and on a `chrome.alarms` timer
  every 5 minutes while entries remain. Drop an entry after 5 attempts or
  7 days. Add the `alarms` permission.
- The capture toast does not wait for the upload.

### API and worker

- `PUT /api/links/:id/page` with `{ url, html, capturedAt }`, behind the
  same auth as capture, with its own 10 MB body limit. Reject when the link
  does not exist, or when `url` and the link's URL differ after
  canonicalization.
- Store the HTML in a short-lived table `page_snapshots (link_id primary
  key, html, url, captured_at, created_at)`, replacing any older snapshot for
  that link, and enqueue `reader-from-page`. The worker extracts it with the
  normal pipeline (no fetch), records the Reader with
  `reader_source = 'extension'`, fills empty metadata, recomputes capture
  status, and deletes the snapshot. A daily sweep deletes snapshots older
  than a day.
- Precedence: an automatic capture or sweep never replaces an `extension`
  Reader. A newer extension upload or the owner's "Refresh reader" can. This
  stops the server fetch, which finishes after the click, from overwriting a
  full subscriber Reader with a thin paywalled one.
- Raw page HTML can include the user's name or account details from the
  site header. Silo keeps only the extracted Reader and deletes the raw HTML
  after extraction.

### Acceptance

- Extension unit tests: page copy starts before the capture POST settles;
  the outbox survives a simulated worker restart and retries; size and URL
  checks skip the upload.
- API tests: auth, body limit, URL mismatch, unknown link.
- Integration: a snapshot becomes an `extension` Reader; a later automatic
  capture does not replace it; the snapshot row is gone afterwards.
- QA: load the built extension in a Chrome profile, save an Atlantic and a
  Big Think article, close the tab at once, and confirm the full Reader.

## Parked

- Site logins stored on the server (Wallabag-style site credentials).
- A per-row list badge for paywalled or blocked links.
- Rendering the Live tab from the headless browser or the archive snapshot.
