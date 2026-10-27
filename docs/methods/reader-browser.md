# Rendered Reader through headless Chrome

Render unknown pages in a headless Chromium before extraction, and run
Defuddle inside the rendered page, where it has real CSS. Pages whose content
only exists after their scripts run then get a Reader. This is slice 3 of 3
([slice 1](reader-fidelity.md), [slice 2](reader-stored.md)). It builds on the
stored Reader: rendering happens at capture, refresh and backfill, never when a
link opens. The live path stays static and unchanged.

## Evidence (2026-10-28)

- 8 of 51 test pages failed before extraction: Medium, NYT, realpython (403),
  Ars Technica (405 bot check), Notion (429, then an empty JS shell), Vimeo
  (challenge). Chromium rendered Medium, NYT and realpython with 13-45k
  characters from the same machine.
- Karakeep, Linkwarden and Omnivore all render in headless Chrome before
  extraction; Readwise names the bare-URL fetch as its main parsing failure.
- Defuddle is built for a browser. Under linkedom it gets no computed styles,
  so CSS-hidden elements and mobile-style rules go unseen. In a real page it
  uses them.
- Datacenter IPs are blocked more often than the residential IP used here, so
  a production gain will be smaller for hard bot walls. Rendering fixes
  script-built pages; it does not defeat every bot check.

## Shape

```
enrichLink / refresh / backfill (worker, Node)
  ├─ safeFetch page HTML ──► metascraper (metadata, as today)
  ├─ known source (twitter, youtube, hacker_news, github)? ──► static Reader (today's path)
  └─ otherwise, browser configured?
        yes ──► renderReader(url) ──► Chromium (separate container, no network)
        │         every request ──► route handler in the worker ──► SSRF-checked fetch
        │         after settle: inject Defuddle bundle, parse in page, return HTML
        │       ──► sanitizeReaderContent (slice 1 sanitizer) ──► choose result
        no  ──► static Reader
```

## Browser service

- Image `mcr.microsoft.com/playwright:v1.64.1-noble`, command
  `npx -y playwright@1.64.1 run-server --port 3000 --host 0.0.0.0`. The
  version must equal the `playwright-core` client version; pin both, and keep
  them equal to the root `playwright` dev dependency.
- Prod compose: a `browser` service on a new network with `internal: true`,
  joined only by `browser` and `api`. The container has no route to the
  internet or the LAN. Memory limit 1 GB, `restart: unless-stopped`,
  `init: true`, `shm_size: 1gb`.
- Local compose: the same service under a `browser` profile. Without Docker,
  `pnpm exec playwright run-server --port 3000` works for development.
- The worker connects with `chromium.connect(SILO_BROWSER_WS_ENDPOINT)`. When
  the variable is unset, everything runs as today. Document the variable in
  `.env.example` and `docs/deploy.md`.
- Add `playwright-core` (Apache-2.0) to `@silo/worker` dependencies. It is the
  client only; it downloads no browser.

## Network: the worker fetches everything

Chromium never makes a network request of its own. A `context.route('**/*')`
handler in the worker receives each request and:

- aborts non-http(s) schemes, and resource types `image`, `media`, `font`,
  `websocket`, `eventsource`, `manifest`, `other`;
- fetches `document`, `script`, `stylesheet`, `xhr` and `fetch` requests with
  an SSRF-checked fetch that reuses `safe-fetch.ts` (IP rules, pinned DNS,
  redirect re-checks, per-response byte cap 5 MB) and fulfills the route with
  the result, forwarding only `content-type` and the body;
- forwards the page's method and body for xhr/fetch; drops cookies,
  `authorization` and any request to a blocked address.

Context options: `javaScriptEnabled: true`, `serviceWorkers: 'block'`,
`acceptDownloads: false`, `bypassCSP: false`, no storage state, locale
`en-US`, viewport 1280x900, a current desktop Chrome user agent with the same
`accept-language` as `safeFetch`. Each page gets a fresh context, closed in a
`finally`.

Defense in depth: the internal network means a request that escapes routing
(WebRTC, DNS prefetch) has nowhere to go. Routing is the primary guard and the
network isolation is the backstop; test both (below).

## Budgets (performance)

- One page at a time per process (a FIFO like `ReaderPool`); capture,
  refresh and backfill share it.
- Per page: 20 s hard deadline from `newContext` to result; at most 200
  routed requests and 20 MB fulfilled bytes, then abort the rest.
- Settle: `goto` with `waitUntil: 'domcontentloaded'`, then wait until 800 ms
  pass with no routed request in flight, capped at 6 s after DOM ready.
- Rendered image sizes: before Defuddle runs, set `width` and `height` on
  each `img` to its rounded rendered box (`getBoundingClientRect`) when that
  box is visible and smaller than the natural size. Publisher CSS often
  shrinks a large source (Troy Hunt's 400x147 Spotify badge renders at about
  134px wide); a static fetch never sees that CSS, so the Reader shows the
  full natural size. The slice 1 sanitizer keeps these attributes.
- Extraction in the page: inject the Defuddle UMD bundle
  (`defuddle/dist/index.js`, read once at startup) with `addScriptTag`, run
  `new Defuddle(document, { useAsync: false }).parse()` inside
  `page.evaluate`, and return `{ content, wordCount }` only. Cap the returned
  string at 4 MB before sanitizing.
- Reconnect if the browser connection drops; after 3 consecutive render
  failures, skip rendering for 5 minutes (circuit breaker) and use the static
  path, logging once.

## Choosing the result (data quality)

Run the static path as today (it is cheap, 0.2-2 s), then the rendered path,
and keep one:

- Rendered result missing, a challenge page (`isChallengePage` on the
  rendered DOM via a small in-page check), or empty: use static.
- Static empty or under `FULL_TEXT_THRESHOLD`: use rendered.
- Both present: use rendered when its text length is at least 80% of
  static's; otherwise static. This guards against a consent wall or error
  overlay that rendered in place of the article.

Search text follows the chosen Reader. Record the choice in a debug log line
with both lengths.

`READER_VERSION` goes to `2` when this lands, so the backfill re-renders
stored links.

## Verification

- Unit tests with a fake browser port: routing decisions (scheme, type,
  blocked IP), budget enforcement, choice rules, circuit breaker, static
  fallback when unset.
- Integration test against a real `playwright run-server` started by the
  test (skip when Chromium is missing, like the Postgres tests): a local
  fixture site whose article is built by a script renders through the route
  handler; a fixture that requests `http://127.0.0.1:<port>` and
  `http://169.254.169.254/` gets those requests blocked, asserted on the
  fixture server's own access log.
- Real-site QA: rerun the 51-URL comparison with rendering. Report per page
  static vs rendered text, chosen path, and render time. Expect Medium, NYT
  and realpython to gain a Reader; record Ars and Notion honestly.
- Measure: p50/p95 render time and peak browser memory over the 51 pages.
- Gate: `pnpm turbo run check-types test` and `pnpm quality`; build the prod
  image and `docker compose -f docker-compose.prod.yml config` to validate
  the compose file.
