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
  blocked". So the main failure is a bot check, not a paywall.
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

Migration `0033` adds two nullable columns to `links`:

- `reader_access reader_access` with values `paywalled` and `blocked`.
  `null` means no known restriction.
- `reader_access_at timestamptz`: when the page read behind that value
  started. It orders access observations apart from Reader writes, so an
  older read that finishes late cannot erase a newer `blocked`.

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
  `http-error` and status 401, 403 or 429, or status ### Write path

- One core function, `recordReaderAccess(id, access, observedAt)`, owns the
  two columns. It writes only when `reader_access_at` is null or not newer
  than `observedAt`, skips trashed and X links, and never touches Reader
  columns or `updated_at`. `recordReader` does not write access.
- An observation is a completed page read. A blocked fetch or a challenge
  page gives `blocked`. A successful static or accepted rendered page gives
  `paywalled` or `null`. Timeouts, 5xx, DNS errors and aborts are not
  observations and leave the value as it is.
- Capture (every `enrich.ts` branch, including the held-full and
  selected-fields paths) and refresh record access with the fetch start
  time. One helper maps a fetch, extract or render outcome to the value.
- Capture status mapping stays as it is (`bare`/`partial`), so retry
  behavior does not change.
- Opening a link (`live-reader.ts`) writes nothing, as before.
- An HTTP-200 challenge page still gets the headless browser attempt. An
  accepted render takes its access from the rendered page.
try behavior does not change.
- Capture, refresh (`refresh-reader.ts`) and the live Reader
  (`live-reader.ts`) all report access the same way. Put the mapping in one
  helper; do not repeat it per path.
- Fix: a challenge page must not supply title, description or image, on the
  full and the metadata-only extraction paths. Today `pageResult` keeps
  metascraper fields from "Just a moment..." pages.

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
  Silo saved its details." Actions: Open original, Retry capture, and Show
  live page when the Live tab is available.
- **Reader with no text, `blocked`:** title "Blocked by the site", body
  "This site stopped Silo with a bot check. Silo saved the link and its
  details." Actions: Open original, Retry capture.
- A saved description still shows above either card. Silo never hides
  text it has.
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

### Evidence (2026-11-06, after slice 1)

- Silo's own headless browser does not help here. It routes every page
  request through `safeFetch` (`browser/route.ts`), so Cloudflare blocks it
  the same way: Big Think failed in 2.7 s. The Atlantic's block page passed
  as a 388-character article until slice 1 learned "Your access has been
  blocked". The browser is left out of this slice.
- Feeds: `https://bigthink.com/feed/` answers, and its `<description>` held
  28k characters for the Higgs article. The Atlantic answers only at
  `/feed/all/`; `/feed`, `/rss`, `/rss.xml`, `/feed.xml`, `/atom.xml` and
  `/index.xml` return 403 or 404. Its Atom `<content>` held 13.6k characters
  for the hockey article, whose page shows about 2k to a visitor.
- `feeds/resolve.ts` needs the page itself to succeed before it probes, so it
  cannot discover a feed for a blocked page.
- Internet Archive: the availability API returns no snapshot for these two
  new articles. For a 2008 Atlantic article it returned a 2026-10-16
  snapshot, and the raw `id_` copy held 38 paragraphs (24k characters).

### When to look elsewhere

After the page read, run the sources below when the page gave no Reader
(blocked, challenge, or `no_reader`) or the page is `paywalled`. Try them in
order and stop at the first one that gives a Reader:

1. **The site's feed.** Candidate feed URLs, at most three per capture:
   feeds the owner follows in Silo whose `site_url` host equals the link's
   host, then `<origin>/feed` and `<origin>/rss.xml`. Remember a host's
   working feed URL, or that it has none, in memory for an hour. Parse with
   `feeds/parse.ts`. Match the entry whose link equals the saved URL after
   core `canonicalize` (it drops tracking parameters and fragments). Use the
   entry's `content:encoded`, Atom `content`, or `description`, whichever is
   longest, when its text has at least `FULL_TEXT_THRESHOLD` characters.
   Build the Reader with the normal extraction and sanitizer, from a minimal
   document holding the entry title and that HTML.
2. **Internet Archive.** One availability request
   (`https://archive.org/wayback/available?url=<url>`), then the raw
   snapshot (`https://web.archive.org/web/<timestamp>id_/<url>`), extracted
   like a page. Reject a challenge page or a result with no Reader.

For a `paywalled` page, a source Reader replaces the page Reader only when
its text is at least 1.5 times as long. A source never changes
`reader_access`: the label still describes the page itself.

Refresh runs the same sources. Opening a link (`live-reader.ts`) does not.

### Data

Migration `0034` adds to `links`:

- `reader_source reader_source` (`page`, `feed`, `archive`; `null` on old
  rows means `page`).
- `reader_source_at timestamptz`: the archive snapshot time; `null` for
  other sources.

`recordReader` writes both with the Reader columns, and leaves them as they
are whenever it keeps an earlier Reader. API, MCP `get_link` and `LinkJson`
return `readerSource` and `readerSourceAt`.

### Web

A quiet line under the Reader meta, in the same style as the slice 1
notice: "From the site's feed." or "From the Internet Archive, snapshot of
16 Oct 2026." The archive line links to
`https://web.archive.org/web/<timestamp>/<url>`. The `blocked` and
`paywalled` empty states appear only when every source failed.

### Rules

Every request goes through `safeFetch` with Silo's user agent. Each source
has its own timeout (15 s) and failure only logs. A capture makes at most
three feed requests and two archive requests.

### Acceptance

- Unit tests with recorded feed and archive fixtures (no network): entry
  matching with tracking parameters, longest-field choice, threshold, host
  cache, archive "no snapshot", archive challenge copy.
- Integration (real Postgres): a blocked capture with a matching feed entry
  stores a `feed` Reader and keeps `reader_access = 'blocked'`; a paywalled
  capture keeps the page Reader when the feed text is shorter.
- QA on the QA database: Big Think (expect `feed`), the 2008 Atlantic
  article (expect `archive`), and the Atlantic hockey article if it is still
  in `/feed/all/` (expect no Reader, since that URL is not a candidate).

## Slice 3: the page from the user's browser

Uploads use the server time the worker processes them for Reader ordering, because Silo's own capture of the link often reads the page after the upload arrives. The client capture time is a consumed-upload watermark that rejects replays; clocks over ten minutes ahead are rejected. Outbox entries bind to the capture server and are discarded if settings switch servers.

The extension sends the page the user is looking at, so subscriber and
bot-checked pages save in full.

### Extension (`extensions/chrome`)

- On every capture trigger, start two things at the same moment:
  `POST /api/links` with the URL (unchanged), and
  `chrome.scripting.executeScript` on the tab that returns
  `{ url: location.href, html: document.documentElement.outerHTML, capturedAt }`.
  `activeTab` already covers all three triggers. Reading the page takes well
  under a second, so closing the tab right after the toast is safe.
- Skip the page copy when the serialized JSON payload is larger than 9 MB,
  or when the tab URL no longer equals the captured URL.
- After both finish, put `{ linkId, baseUrl, url, html, capturedAt, attempts }` in an
  IndexedDB outbox, then upload it. Remove the entry on success or on a 4xx
  answer other than 408/429.
- Retry the outbox on service-worker start (`runtime.onStartup`,
  `runtime.onInstalled`), on each new capture, and on a `chrome.alarms` timer
  every 5 minutes while entries remain. Drop an entry after 5 attempts or
  7 days. Add the `alarms` permission.
- The capture toast does not wait for the upload.

### API and worker

- `PUT /api/links/:id/page` with `{ url, html, capturedAt }`, behind the
  same auth as capture, with its own 12 MB body limit. Reject when the link
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
- An upload replaces a stored Reader when none is usable or its text is at
  least as long. A non-subscriber's browser sees only the teaser, which must
  not replace a full article from any source.
- Raw page HTML can include the user's name or account details from the
  site header. Silo keeps only the extracted Reader and deletes the raw HTML
  after extraction.
- Reject a challenge page or a successful extraction with no Reader; keep the
  current Reader. Retry transient parser failures and retain the snapshot.
- Migration `0035` adds `extension` to the `reader_source` enum and creates
  `page_snapshots`, plus `links.reader_upload_at` for the consumed-upload watermark.
- An upload does not change `reader_access`; that label still describes what
  Silo's own fetch saw. The web hides the paywall notice when the Reader
  source is `extension` and shows the source line "Saved from your browser."

### Acceptance

- Extension unit tests: page copy starts before the capture POST settles;
  the outbox survives a simulated worker restart and retries; size and URL
  checks skip the upload.
- API tests: auth, body limit, URL mismatch, unknown link.
- Integration: a snapshot becomes an `extension` Reader; a later automatic
  capture does not replace it; the snapshot row is gone afterwards.
- QA: load the built extension in a Chrome profile, save an Atlantic and a
  Big Think article, close the tab at once, and confirm the full Reader.

## Slice 4: Live tab for blocked sites

Approved 2026-11-06 after Amit tested slice 3: the Live tab for a blocked
site showed the raw URL as a giant headline over one line of text.

### Evidence

- The Atlantic and Big Think send `X-Frame-Options: SAMEORIGIN`, so the Live
  tab cannot frame them, and Silo's proxy fetch is blocked. Only the user's
  own browser can load the live page, in a new tab.
- `web.archive.org` snapshot pages send no `X-Frame-Options` and no
  `frame-ancestors`, so the user's browser can frame a snapshot directly.

### Behavior

- When the Live tab's fetch is `blocked`, the frame hint looks for an
  Internet Archive snapshot: the stored `reader_source_at` when the Reader
  came from the archive, otherwise one availability request through
  `safeFetch`, cached per link for an hour (hits and misses). The hint
  becomes `{ mode: 'archive', archiveUrl, snapshotAt }`, where `archiveUrl`
  is `https://web.archive.org/web/<timestamp>if_/<url>` (the Wayback frame
  form, without its toolbar).
- The web frames that URL directly; Silo never proxies archive pages. A
  slim bar above the frame says it is an archive copy, gives the snapshot
  date, and links to the live site.
- With no snapshot, the blocked state is a centered card in the style of the
  Reader empty state: icon, a short title, one sentence of reason, and
  actions (Show Reader, Open site). The link title, or the host when there
  is no title, appears as quiet meta, never the raw URL as a headline.

### Acceptance

- Worker unit tests: archive hint from a stored snapshot (no request),
  from the availability API, cache hit, no snapshot.
- Web tests: archive mode renders the frame and the bar; blocked mode with
  no snapshot renders the card with the right copy and no URL headline.
- Browser QA at 1440 and 390 px, light and dark: the 2008 Atlantic article
  (archive frame) and the new Atlantic article (card).

## Parked

- Site logins stored on the server (Wallabag-style site credentials).
- A per-row list badge for paywalled or blocked links.
- Rendering the Live tab from the headless browser.
