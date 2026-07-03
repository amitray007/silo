---
title: "feat: First feature slice — enrichment worker (SSRF-safe fetch + static extraction + pg-boss)"
type: feat
date: 2026-07-04
origin: docs/brainstorms/2026-07-03-engineering-foundation-requirements.md
---

# feat: First feature slice — enrichment worker

## Summary

Build silo's first feature: a self-owned background worker that turns a saved link into an understood one. `createLink` enqueues an enrichment job (transactionally, via pg-boss); a separate worker fetches the URL through an SSRF-safe client, extracts metadata + readable full text from the static HTML (metascraper + Readability + a thin embedded-JSON parser — no browser), writes the results back, and transitions `capture_status` to `full` / `partial` / `bare` with honest degraded capture and retry. Also fixes CI so the Postgres-dependent integration tests actually run.

## Problem Frame

The data layer is done (`docs/foundation.md` item 2): `packages/core` exposes `createLink`, which sets `capture_status='enriching'` — but nothing ever moves a link past `enriching`. This slice supplies the missing half of the core loop: a link, once saved, gets fetched and understood in the background so it lands as a rich, answerable card. It is the enrichment engine only — the HTTP API and UI (paste and list surfaces) are a separate slice; this one is verifiable end-to-end via the worker + `core` operations against real Postgres.

The fetch path is the defining risk: the URL is untrusted (pasted, or later agent-supplied over MCP), so server-side fetching is an SSRF surface that must re-defend from scratch. Rendering is deliberately excluded (static-first extraction covers most of the web without a browser; a headless renderer would leak privacy if hosted, or double the SSRF surface if self-owned — deferred).

---

## Requirements

### Enqueue + job lifecycle
- R1. `createLink` enqueues an `enrich-link` job carrying the link id, inside the same transaction that inserts/updates the row (pg-boss `fromDrizzle`), so the job is never lost nor runs before the row is visible.
- R2. Re-saving a link does not stack duplicate enrichment jobs (`singletonKey = linkId`).
- R3. Enrichment jobs retry with backoff on transient failure and route to a dead-letter queue when exhausted; a job never sits `active` longer than a bounded expiry.

### SSRF-safe fetch (security boundary)
- R4. A `safeFetch` module fetches an untrusted URL over http(s) only, resolving DNS itself and **pinning** the connection to a validated IP so the classification and the connection use the same address (closes DNS-rebinding).
- R5. It blocks private, loopback, link-local (incl. `169.254.169.254`), CGNAT, ULA, and IPv4-mapped-IPv6 equivalents (classified via `ipaddr.js`, not hand-rolled regex).
- R6. It re-runs the full validation on every redirect `Location` (redirects capped), caps response size (streamed, not `Content-Length`-trusted), and enforces a total timeout.

### Static-first extraction
- R7. Given fetched HTML, extract title, description, image, and site name (metascraper: OG / Twitter-card / JSON-LD / meta fallthrough) and readable full text (Mozilla Readability over a script-disabled jsdom DOM).
- R8. A thin parser recovers content from embedded-JSON blobs (`__NEXT_DATA__` / `__NUXT__`) when present, squeezing more from SPAs without a browser.
- R9. Charset: decode by the `Content-Type` charset when present, else default UTF-8 (non-UTF-8 `<meta>`-declared bodies are a documented known limitation, parked).

### Capture status + degraded capture
- R10. Enrichment maps its result to a terminal `capture_status`: `full` (good text + metadata), `partial` (metadata but thin/no readable text — includes JS-walled pages), `bare` (neither — e.g. non-HTML or empty).
- R11. `partial` and `bare` are retryable; a dead link / fetch failure leaves the link saved and retryable, never crashes the loop (honest degraded capture — silo never pretends).
- R12. `core` exposes an operation to record an enrichment result (set metadata fields + status) and to re-enqueue a retry, going through the same validated write path as other operations.

### Worker process
- R13. The worker is a separate long-lived entrypoint (its own package) that starts pg-boss, registers the `enrich-link` handler (pg-boss v12 array-handler signature), and stops gracefully on SIGTERM/SIGINT. It depends on `@silo/core` (adapter → core, per architecture rules); the SSRF/extraction libs stay out of `@silo/core`.

### CI
- R14. CI runs the Postgres integration tests for real: a `pgvector/pgvector:pg18` service container, `TEST_DATABASE_URL`/`DATABASE_URL` wired, and a `CI_REQUIRE_DB` guard that fails (not skips) if the DB is unreachable, so integration coverage can never silently vanish.

---

## Key Technical Decisions

- Static-first extraction, no browser (user decision + research) — metascraper reads the OG/Twitter/JSON-LD tags publishers already ship for link unfurls, so most content extracts without rendering. A headless renderer is deferred: a hosted one breaks silo's self-owned/no-third-party identity; a self-owned Chromium adds ~100-200MB + ~300-600MB/render + a second SSRF surface. JS-walled pages capture as retryable `partial` until a future user-triggered render-and-retry slice.
- SSRF defense is a custom undici pinning dispatcher (research Option A) — Node 24's native fetch has no SSRF protection, and the mature library (`request-filtering-agent`) is `http.Agent`-only (incompatible with fetch). The dispatcher's `connect.lookup` resolves, classifies every A/AAAA with `ipaddr.js`, and hands back the single validated IP so the socket connects to exactly what was checked — the strongest, auditable defense. `canonicalize`'s scheme check is a write-time gate, not a fetch-time guard; `safeFetch` re-defends fully.
- pg-boss transactional enqueue via `fromDrizzle` — enqueue the job inside `createLink`'s existing transaction, eliminating the "row committed but job lost / job runs before row visible" race. `singletonKey = linkId` dedups; `{ retryLimit: 3, retryBackoff: true, expireInSeconds: 120, deadLetter }` for the job.
- Separate worker package + its own pg-boss pool — enrichment does heavy blocking-ish I/O that must not contend with API latency and scales independently. pg-boss gets its own connection/pool (its `pgboss` schema, not our tables); do NOT reuse the `@silo/db` app pool for its polling loop. The API-side enqueue uses a lightweight send-only pg-boss handle.
- jsdom over linkedom for Readability — jsdom is Mozilla's demonstrated, spec-compliant DOM; linkedom is lighter but only partially Readability-compatible. Correct extraction is the whole point of the slice, so jsdom now; linkedom is a measured-later optimization. jsdom is constructed with scripts + remote resources disabled (never run untrusted JS).
- `pgvector/pgvector:pg18` CI service image — our migrations `CREATE EXTENSION vector`, so the CI Postgres must ship pgvector; this image does, avoiding a manual extension install. A `CI_REQUIRE_DB` env flag flips the `postgresReachable()` skip into a hard failure in CI so a misconfigured DB can't yield a green build with zero integration coverage.
- JS-wall detection heuristic — escalate to `partial` (not a browser) when `Readability.isProbablyReaderable` is false or parsed text is below a small threshold, or SPA markers (empty body + root mount, `__NEXT_DATA__` with no rendered text, `<noscript>enable JavaScript</noscript>`) are present.

---

## High-Level Technical Design

### The capture → enrich flow

```mermaid
sequenceDiagram
  participant C as core.createLink (in txn)
  participant Q as pg-boss (enrich-link queue)
  participant W as worker (enrich-link handler)
  participant S as safeFetch (SSRF-guarded)
  participant X as extract (static-first)
  participant DB as core.recordEnrichment

  C->>Q: send(enrich-link, {linkId}) in same txn (fromDrizzle), singletonKey=linkId
  Note over C,DB: row committed as status=enriching + job enqueued atomically
  Q->>W: deliver job [batch]
  W->>S: safeFetch(url)
  alt fetch ok (http(s), safe IP, under caps)
    S-->>W: {html, contentType}
    W->>X: metascraper + Readability + embedded-JSON
    X-->>W: {title, description, image, siteName, text}
    W->>DB: recordEnrichment(status = full | partial)
  else blocked / non-html / dead / timeout
    W->>DB: recordEnrichment(status = partial | bare, retryable)
  end
  Note over W,Q: handler throws only on UNEXPECTED errors -> pg-boss retry/backoff -> DLQ
```

### safeFetch validation gate (the security boundary)

```mermaid
flowchart TB
  u[untrusted url] --> sch{http/https only?}
  sch -->|no| block[reject]
  sch -->|yes| dns[resolve DNS ourselves - all A/AAAA]
  dns --> cls{any addr private/loopback/link-local/CGNAT/ULA/mapped?}
  cls -->|yes| block
  cls -->|no| pin[connect PINNED to the one validated IP]
  pin --> resp{redirect?}
  resp -->|Location, under cap| sch
  resp -->|body| caps{under size cap and timeout?}
  caps -->|no| block
  caps -->|yes| ok[return html]
```

Classification uses `ipaddr.js` `.range()`; the pinned `lookup` makes the checked IP and the connected IP identical (no TOCTOU rebinding window). This module is the security boundary and gets its own adversarial review pass.

### Capture status mapping

```mermaid
stateDiagram-v2
  [*] --> enriching: createLink
  enriching --> full: metadata + readable text
  enriching --> partial: metadata only / thin / JS-walled
  enriching --> bare: non-HTML / empty / dead
  partial --> enriching: retry
  bare --> enriching: retry
  full --> [*]
```

---

## Output Structure

```text
packages/
  worker/                         # new — the enrichment worker (adapter -> core)
    package.json                  # deps: @silo/core, pg-boss, metascraper(+rules), @mozilla/readability, jsdom, ipaddr.js
    src/
      queue.ts                    # pg-boss client factory (send-side + work-side), queue names, job options
      worker.ts                   # long-lived entrypoint: start boss, register handler, graceful stop
      enrich.ts                   # enrichLink(linkId): fetch -> extract -> recordEnrichment; maps status
      fetch/
        safe-fetch.ts             # SSRF-safe fetch: undici pinning dispatcher, redirect re-validation, caps
        safe-fetch.test.ts        # dense adversarial matrix (unit, no network where possible)
        ip-rules.ts               # ipaddr.js classification (private/loopback/link-local/mapped/CGNAT/ULA)
      extract/
        extract.ts               # metascraper + Readability(jsdom) + embedded-JSON, JS-wall heuristic
        embedded-json.ts          # __NEXT_DATA__ / __NUXT__ thin parser
        extract.test.ts           # fixture-HTML extraction + status-mapping tests
      enrich.test.ts              # integration: createLink enqueues -> handler runs -> row enriched (real pg)
packages/core/
  src/links/
    enrichment.ts                 # recordEnrichment(linkId, result) — validated write path + retry re-enqueue
    enrichment.test.ts
  # createLink modified to enqueue via fromDrizzle inside its txn
.github/workflows/ci.yml          # pgvector/pgvector:pg18 service + DB env + CI_REQUIRE_DB
```

Per-unit `Files` are authoritative; the implementer may adjust layout.

---

## Implementation Units

Dependency-ordered. Each is independently landable and committed on completion, following the binding review protocol (CodeRabbit + independent `ce-code-review` + intense QA vs real Postgres) before the next. Feature-bearing units carry test scenarios.

### U1. CI runs the Postgres integration tests

- Goal: make CI actually execute the DB-dependent suites (they currently `describe.skip`), so every unit below is covered in CI.
- Requirements: R14.
- Dependencies: none (do first — it de-risks everything after).
- Files: `.github/workflows/ci.yml`, `packages/db/src/test-support/disposable-database.ts` (add the `CI_REQUIRE_DB` hard-fail path), `packages/db/src/test-support/pg-harness.ts` / `packages/core/src/test-support/pg-harness.ts` if the guard belongs there.
- Approach: add a `pgvector/pgvector:pg18` service container to the `gate` job with a `pg_isready` health check; export `TEST_DATABASE_URL` + `DATABASE_URL` (`postgres://postgres:postgres@localhost:5432/postgres`) to the test step. Add `CI_REQUIRE_DB`: when set, `postgresReachable()` returning false becomes a thrown error rather than `describe.skip`, so a broken DB URL fails CI instead of silently skipping. Confirm `psql`/`createdb` exist on the runner (ubuntu-latest ships postgresql-client; install if a future image drops it). Consider splitting a fast unit lane from the DB integration lane.
- Patterns to follow: GitHub Actions service-container docs; the existing harness's `postgresReachable()` gate.
- Test scenarios:
  - Verification is the CI run itself: the existing db/core integration suites (78 tests) run green in CI, not skipped.
  - Negative: with `CI_REQUIRE_DB=1` and a deliberately-wrong DB URL, CI fails loudly (verified once during implementation).
  - Test expectation: none beyond the workflow executing — CI config.
- Verification: a CI run shows the integration suites executed (test count matches local); flipping the DB URL with `CI_REQUIRE_DB=1` turns the run red.

### U2. SSRF-safe fetch module (security boundary)

- Goal: a heavily-tested `safeFetch` that fetches an untrusted URL while blocking SSRF, with IP pinning, redirect re-validation, size cap, and timeout.
- Requirements: R4, R5, R6.
- Dependencies: none (pure module; lands in the new `packages/worker`).
- Files: `packages/worker/package.json`, `packages/worker/src/fetch/safe-fetch.ts`, `packages/worker/src/fetch/ip-rules.ts`, `packages/worker/src/fetch/safe-fetch.test.ts`, `packages/worker/tsconfig.json`.
- Approach: build an undici `Agent` whose `connect.lookup` resolves the hostname, classifies every returned address with `ipaddr.js` (`ip-rules.ts` maps the blocked ranges), and returns only a single validated IP — pinning the socket to the checked address. `fetch(url, { dispatcher, redirect: 'manual', signal })`; re-run full validation on each redirect `Location` (cap 5); stream the body counting bytes, aborting past a max (e.g. 5MB); `AbortController` total timeout (e.g. 10s); http(s) scheme allowlist (belt-and-suspenders with canonicalize). Return `{ ok, html, contentType, finalUrl }` or a typed failure reason.
- Execution note: security-critical — start with the adversarial test matrix; this module gets its own dedicated adversarial review before merge.
- Patterns to follow: research Option A (undici pinning dispatcher); `ipaddr.js` `.range()` classification.
- Test scenarios:
  - Happy path: a normal public http(s) URL fetches and returns HTML + content-type.
  - Error/security: rejects `http://127.0.0.1`, `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.1`, `http://192.168.1.1`, `http://[::1]`, `http://[::ffff:169.254.169.254]` (IPv4-mapped IPv6), `http://100.64.0.1` (CGNAT), a decimal/hex-encoded loopback (`http://2130706433`).
  - Error/security: a public URL that 302-redirects to `http://169.254.169.254/` is blocked at the redirect (not followed).
  - Edge: a body exceeding the size cap is aborted; a hung server hits the total timeout; a non-http(s) scheme is rejected.
  - Edge: DNS-rebinding — the resolved IP is the one connected to (pinning), asserted via the lookup contract.
- Verification: the full adversarial matrix passes; every blocked case returns a typed failure without connecting to the internal address.

### U3. Static-first extraction

- Goal: given HTML, produce `{ title, description, image, siteName, text }` and a capture-status classification, using no browser.
- Requirements: R7, R8, R9, R10.
- Dependencies: none (pure, fixture-driven).
- Files: `packages/worker/src/extract/extract.ts`, `packages/worker/src/extract/embedded-json.ts`, `packages/worker/src/extract/extract.test.ts`, plus HTML fixtures under `packages/worker/src/extract/__fixtures__/`.
- Approach: compose metascraper with title/description/image/logo/publisher/url rules (map publisher→siteName, image→imageUrl) over the fetched HTML (no library-side fetch). Build a jsdom DOM with scripts + remote resources disabled, run Readability for `textContent`. When Readability is thin, try `embedded-json.ts` (`__NEXT_DATA__`/`__NUXT__` → recover text/metadata). Classify: `full` (metadata + text ≥ threshold), `partial` (metadata only / thin / JS-wall markers), `bare` (neither / non-HTML). Charset: decode by `Content-Type` charset, else UTF-8 (park non-UTF-8-meta bodies as a known limitation). Do NOT add `metascraper-logo-favicon` (third-party favicon fetch — violates the privacy rule).
- Patterns to follow: metascraper `({url, html})` contract; `Readability.isProbablyReaderable` for the JS-wall heuristic.
- Test scenarios:
  - Happy path: a normal article HTML fixture yields title/description/image/siteName + non-trivial text → `full`.
  - Edge: an OG-tags-only SPA shell (no readable body) → metadata extracted, `partial`.
  - Edge: a `__NEXT_DATA__`-bearing SPA → embedded-JSON parser recovers text/metadata.
  - Edge: an empty/JS-wall shell (`<div id="root"></div>`, `<noscript>enable JavaScript</noscript>`) → `partial` via the heuristic.
  - Edge: a non-HTML body (e.g. a PDF/JSON content-type) → `bare`.
  - Edge: null/short description/text still classifies without throwing.
  - Security: jsdom does not execute scripts in the fixture (a `<script>` that would set a global is inert).
- Verification: each fixture maps to the expected fields + status; no network is touched; scripts never run.

### U4. Enrichment write path in core

- Goal: a `core` operation that records an enrichment result (metadata + terminal status) and a retry re-enqueue, through the validated write path.
- Requirements: R10, R11, R12.
- Dependencies: U3 (uses the extraction result shape).
- Files: `packages/core/src/links/enrichment.ts`, `packages/core/src/links/enrichment.test.ts`, `packages/core/src/index.ts` (export).
- Approach: `recordEnrichment(linkId, result)` updates title/description/imageUrl/siteName/extractedText + `captureStatus` (full/partial/bare) on a live link (via the live-query helper; `updated_at` bumps via `$onUpdate`); a `null`/failure result records the terminal retryable status without clobbering existing good metadata. A `requestRetry(linkId)` helper sets status back to `enriching` and signals a re-enqueue (the actual enqueue is the worker/queue's job — core stays db-only). Validate inputs with Zod at the boundary.
- Patterns to follow: existing `editLink`/`softDelete` live-scoped update shape; the `mergeIntoExisting` "don't clobber with absent fields" rule.
- Test scenarios:
  - Happy path: `recordEnrichment` with full metadata sets the fields and `captureStatus='full'`; `getById` reflects it; `updated_at` advanced.
  - Edge: recording `partial` keeps prior metadata where the new result omits a field.
  - Edge: recording on a trashed link is a no-op (live-scoped) — enrichment never resurrects trash.
  - Error: an invalid result shape is rejected by Zod before write.
  - Retry: `requestRetry` returns a link to `enriching`.
- Verification: status transitions and field updates are correct against real Postgres; trashed links are untouched.

### U5. Worker: pg-boss queue + handler + entrypoint, wired to createLink

- Goal: the running worker — pg-boss queue, the `enrich-link` handler tying fetch→extract→record together, transactional enqueue in `createLink`, and a graceful entrypoint.
- Requirements: R1, R2, R3, R13.
- Dependencies: U2, U3, U4.
- Files: `packages/worker/src/queue.ts`, `packages/worker/src/worker.ts`, `packages/worker/src/enrich.ts`, `packages/worker/src/enrich.test.ts`, `packages/core/src/links/links.ts` (enqueue in `createLink`'s txn), `packages/core/package.json` (+ pg-boss for the send-side / `fromDrizzle`), root `pnpm-workspace.yaml` (catalog: pg-boss, metascraper + rules, @mozilla/readability, jsdom, ipaddr.js).
- Approach: `queue.ts` — a pg-boss factory with its own connection/pool (separate from `@silo/db`), `createQueue('enrich-link', {...})`, job options (`retryLimit:3, retryBackoff:true, expireInSeconds:120, singletonKey, deadLetter:'enrich-link-dlq'`). `enrich.ts` — `enrichLink(linkId)`: load link → `safeFetch` → `extract` → `recordEnrichment`; expected failures (blocked/dead/thin) map to a terminal retryable status and RESOLVE (don't throw); only unexpected errors throw so pg-boss retries. `worker.ts` — start boss, `boss.work('enrich-link', {batchSize:1, localConcurrency}, async ([job]) => enrichLink(job.data.linkId))` (v12 array handler), SIGTERM/SIGINT → `boss.stop({graceful:true})`. `createLink` — enqueue `enrich-link` via `fromDrizzle(tx, sql)` inside its existing transaction, `singletonKey=linkId`.
- Execution note: start with the end-to-end integration test (createLink → job delivered → row enriched) to pin the contract.
- Patterns to follow: pg-boss v12 array-handler signature; `fromDrizzle` transactional send; the existing `createLink` transaction.
- Test scenarios:
  - Integration (happy): `createLink` for a fetchable URL enqueues a job; running the handler enriches the row to `full` with metadata; only one job per link (singletonKey).
  - Integration (degraded): a URL that `safeFetch` blocks (e.g. a link-local host) records `partial`/`bare` and the handler RESOLVES (no infinite retry).
  - Integration (transactional enqueue): if the `createLink` transaction rolls back, no enrich job is left enqueued (job + row are atomic).
  - Edge: re-saving the same link does not create a second active job.
  - Failure: an unexpected error in the handler throws → pg-boss retries with backoff → exhausts to the DLQ (assert retry/DLQ routing, e.g. with a forced-failure job).
  - Lifecycle: `boss.stop({graceful})` waits for an in-flight job.
- Verification: end-to-end createLink→enrich works against real Postgres; degraded captures resolve; transactional enqueue holds; retries/DLQ route correctly.

---

## Scope Boundaries

### In this slice
The enrichment worker: transactional enqueue, SSRF-safe fetch, static-first extraction, capture-status transitions with degraded capture + retry, and CI running the integration tests. This is the first feature slice's enrichment engine.

### Deferred to follow-up work (plan-local)
- Headless-shell render-and-retry for genuine JS-walls — deferred by user decision (static-first covers most content; a self-owned renderer adds footprint + a second SSRF surface). Add later as a rare, user-triggered path only if the measured `partial` rate justifies it.
- Non-UTF-8 `<meta>`-charset decoding — known limitation, park in `future-scope.md`.
- linkedom-for-Readability optimization — measured-later, if jsdom memory/throughput is a real problem.
- A pooled/reused fetch or browser — premature; per-job is leak-proof and fine at this volume.

### Deferred for later (origin: docs/brainstorms/2026-07-03-engineering-foundation-requirements.md)
- The HTTP API + UI (paste and list surfaces) — a separate web/api slice; this slice is verified via the worker + `core`.
- The MCP surface (Next stage), plugin system + HN/Twitter plugins, capture extension + activity trail, semantic/pgvector index.

### Outside this product's identity (origin)
No AI inside silo, not a file store, not a content archive, not multi-user, no read-later queue. **No third-party calls per row** — reaffirmed here: no hosted render/extract API, no favicon-service fetch.

---

## Risks & Dependencies

- SSRF is the defining risk — untrusted URLs fetched server-side. Mitigation: the pinning dispatcher (U2) with a dense adversarial test matrix and its own dedicated adversarial review; `canonicalize`'s scheme gate is reaffirmed as write-time-only, not the fetch guard.
- pg-boss v12 array-handler footgun — `boss.work` delivers an array, not a single job; a naive single-job handler silently mis-processes. Mitigation: `batchSize:1` + `([job]) =>` destructure, pinned by the integration test.
- Transactional enqueue coupling — `createLink` now depends on pg-boss (`fromDrizzle`) for the send side. Mitigation: keep the send-side handle lightweight and separate from the worker's `work` instance; test the rollback-drops-job case.
- pg-boss owns a `pgboss` schema + background maintenance — expect extra tables/queries; scope knip/migrations so they aren't flagged, and don't reuse the `@silo/db` app pool for polling.
- Fetching arbitrary pages is slow/flaky — network timeouts, huge bodies, redirects. Mitigation: size cap + total timeout + bounded retries + DLQ; expected failures resolve as degraded capture rather than throwing.
- CI Postgres wiring — a misconfigured service URL could make integration tests silently skip green. Mitigation: `CI_REQUIRE_DB` hard-fails on unreachable DB (R14, U1).
- Version currency (2026): pg-boss 12.25.0, metascraper 5.51.x, @mozilla/readability 0.6.0, jsdom 29.1.x, ipaddr.js 2.4.x, pgvector/pgvector:pg18. Pin via the pnpm catalog.

---

## Sources & Research

- pg-boss v12 type defs — informed the array-handler, `fromDrizzle` transactional enqueue, job options, own-schema/own-pool, graceful stop (U1/U5 KTDs).
- OWASP SSRF-Prevention-in-Node + undici DNS/dispatcher docs + `ipaddr.js` — informed the pinning-dispatcher design and the blocked-range matrix (U2).
- metascraper source + `@mozilla/readability` + jsdom-vs-linkedom + the static-first / social-unfurl analysis — informed the no-browser extraction and JS-wall heuristic (U3), and the deferral of rendering.
- Lightpanda (AGPL, beta) and agent-browser (Chromium wrapper, no savings) — evaluated and deferred/rejected as renderers; recorded in Scope Boundaries.
- GitHub Actions PostgreSQL service containers + `pgvector/pgvector:pg18` image — informed U1.
