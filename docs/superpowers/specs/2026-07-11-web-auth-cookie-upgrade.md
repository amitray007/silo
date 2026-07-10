# Web auth upgrade — shared password + signed HTTP-only cookie session

**Status:** proposed (gate-1 pending user approval)
**Supersedes:** `docs/superpowers/specs/2026-07-10-web-auth-design.md` **Decision 2**
("No cookies/sessions server-side"). See "Superseding note" below.
**Date:** 2026-07-11

## Motivation

silo already has a working web login (plan 030): the Oat-styled `LoginGate`
card, the `AuthGate` in `App.tsx`, the `/api/auth/check` probe, and the
401→login bounce. Today it gates on **`SILO_API_TOKEN`**: the user types the
raw API token, which is held in `sessionStorage` and sent as an
`Authorization: Bearer` header on every call.

Two problems with that mechanism for a **human** logging into the web UI:
1. The token is **XSS-readable** (any injected script can read `sessionStorage`).
2. A human is asked to type/paste a long **machine** secret (the same token
   extensions and MCP use) — and rotating it rotates every integration at once.

This upgrade keeps the same *login screen and gate posture* but changes the
*mechanism* to the "simple, Stash-like" model the user asked for:
- a dedicated **`SILO_APP_PASSWORD`** (a human password, separate from the
  machine `SILO_API_TOKEN`),
- exchanged for a **signed, HTTP-only, SameSite cookie** session (not
  JS-readable; auto-sent on navigation),
- the API gate accepts **the cookie OR the existing Bearer token**, so
  extensions/MCP are completely unaffected.

### Superseding note

Plan 030's Decision 2 rejected cookies to "avoid CSRF surface." We accept a
small, well-understood CSRF surface and mitigate it the standard way:
`SameSite=Lax` (blocks cross-site POSTs from carrying the cookie) + the login
being a same-origin SPA. The XSS win (HTTP-only cookie vs. XSS-readable
sessionStorage) and the human-password-vs-machine-token separation outweigh
it for this single-user tool. This note is the record; plan 030's file stays
as history.

## Posture (unchanged from plan 030)

- **`SILO_APP_PASSWORD` unset ⇒ no login.** The web app renders directly; the
  API gate is a no-op. localhost `pnpm dev` is completely unaffected. This
  mirrors today's "unset token = open" default.
- **`SILO_APP_PASSWORD` set ⇒ the web UI shows `/login`** until a correct
  password establishes a session cookie.
- **Extensions / MCP are never affected** — they authenticate with
  `Authorization: Bearer <SILO_API_TOKEN or DB token>`, which the gate still
  accepts. The cookie is an *additional* accepted credential, not a replacement.

## Relationship between the two secrets

| Secret | Who uses it | How | Gate branch |
|---|---|---|---|
| `SILO_APP_PASSWORD` | a human, in the web UI | typed once → signed cookie | cookie branch (new) |
| `SILO_API_TOKEN` | extensions, MCP, CLI | `Authorization: Bearer` | bearer branch (existing) |
| DB access tokens | named tokens (Access tab) | `Authorization: Bearer` | `verifyAccessToken` (existing) |

The general gate is "open" only when **both** `SILO_APP_PASSWORD` **and**
`SILO_API_TOKEN` are unset (i.e. nothing is configured to protect). If either
is set, the gate is on and requires a matching credential of the appropriate
kind. (Rationale: a deployment that sets a web password clearly wants the API
protected too; and the web UI's own `/api/*` calls must be gated or the
password would be pointless.)

## Cookie design

- **Name:** `silo_session`
- **Value:** a signed cookie (Hono `setSignedCookie`/`getSignedCookie`, HMAC
  over a fixed sentinel payload). The payload is **not** a per-user identity
  (single-user tool) — it is a constant marker (e.g. `"ok"`) whose *signature*
  is the proof. Verifying the signature ⇒ the setter knew the secret ⇒ the
  request is authenticated. Stateless: **no DB table.**
- **Signing secret:** `SILO_SESSION_SECRET` if set, else derived from
  `SILO_APP_PASSWORD` (HMAC key = the password) so a single-secret deployment
  Just Works. Documented in `.env.example`.
- **Attributes:** `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the
  request is HTTPS (prod) and **not** `Secure` on plain-http localhost (dev),
  `Max-Age` ~30 days.
- **Logout:** delete the cookie (`Max-Age=0`).

## Units (independent, each with its own acceptance check)

Ordered so each leaves the tree working. Units 1–3 are API (core + edge),
4–6 are web. Every unit ships with tests.

---

### Unit 1 — core: password verify + session-cookie sign/verify helpers

**Where:** `packages/core/src/auth/` (new `app-session.ts`), exported via the
barrel. Reuse existing `timingSafeEqual`/`readTokenEnv`.

- `readAppPassword(): string | undefined` — `readTokenEnv('SILO_APP_PASSWORD')`.
- `verifyAppPassword(candidate: string): boolean` — timing-safe compare against
  the configured password; `false` if unset.
- `sessionSecret(): string | undefined` — `SILO_SESSION_SECRET` ?? the app
  password (so a lone `SILO_APP_PASSWORD` still signs).
- The actual cookie signing/verifying uses **Hono's** `setSignedCookie`/
  `getSignedCookie` at the edge (Unit 2), so core only needs to expose the
  secret + the password check. (Keeps core free of Hono — the boundary rule.)

**Acceptance:** unit tests — `verifyAppPassword` is timing-safe, returns false
when unset, true only on exact match; `sessionSecret` precedence
(`SILO_SESSION_SECRET` wins, falls back to password, undefined when neither).

---

### Unit 2 — api: `/api/login`, `/api/logout` routes (root app, ungated)

**Where:** new `packages/api/src/routes/login.ts`; `registerLoginRoutes(app)`
registered on the **root** app in `app.ts` next to `registerAuthRoutes` (so
login itself is reachable without the gate). CORS-wrap the two paths like
`/api/auth/check`.

- `POST /api/login` — body `{ password: string }` (Zod). If
  `verifyAppPassword(password)` → `setSignedCookie(c, 'silo_session', 'ok',
  sessionSecret, { httpOnly, sameSite:'Lax', path:'/', secure: <https?>,
  maxAge })`, return `200 { ok: true }`. Else `401 { error: 'unauthorized' }`.
  When no password is configured, `POST /api/login` returns `400`
  (login isn't applicable) — the web never calls it in that state.
- `POST /api/logout` — delete the cookie, `200 { ok: true }`. Always safe.

**Acceptance:** `login.test.ts` (no DB — env set/restore like `auth.test.ts`):
correct password ⇒ 200 + `Set-Cookie: silo_session=…; HttpOnly; SameSite=Lax`;
wrong ⇒ 401, no cookie; logout ⇒ `Set-Cookie` with `Max-Age=0`.

---

### Unit 3 — api: gate accepts the session cookie; `/api/auth/check` reports cookie auth

**Where:** `packages/api/src/general-auth.ts` (extend `generalTokenAuth`) and
`packages/api/src/routes/auth.ts` (extend `/api/auth/check`).

- **Gate** (`generalTokenAuth`): change the "configured?" test to "is EITHER
  `SILO_API_TOKEN` or `SILO_APP_PASSWORD` set?". If neither → open (no-op).
  Otherwise, accept in order: valid Bearer env-token → valid Bearer DB-token →
  **valid signed `silo_session` cookie** → else 401. The cookie branch uses
  `getSignedCookie(c, sessionSecret, 'silo_session')` and checks it verifies to
  the sentinel. Extensions/MCP (Bearer) unchanged.
- **`/api/auth/check`**: report `authRequired: <either secret set>` and
  `authenticated: <valid Bearer OR valid session cookie>`. So the web guard
  can tell "logged in via cookie" without holding any token client-side.

**Acceptance:** extend `general-auth.test.ts` — with `SILO_APP_PASSWORD` set:
no credential ⇒ 401; a request replaying a `silo_session` cookie minted by
`/api/login` ⇒ 200; a tampered/forged cookie ⇒ 401; Bearer env-token still ⇒
200 (extension path intact). `auth/check` returns the right booleans for
cookie-authed vs. anonymous.

---

### Unit 4 — web: send credentials; drop the sessionStorage token path

**Where:** `packages/web/src/api/client.ts` (`apiFetch`), `src/api/auth.ts`.

- `apiFetch` adds `credentials: 'include'` (so the browser sends `silo_session`
  same-origin) and **stops attaching the `Authorization: Bearer` header** from
  `sessionStorage` (the web no longer holds a token — the cookie is the
  credential). The 401 path stays: on 401, `emitAuthCleared()` so `AuthContext`
  bounces to `/login` (no token to clear anymore, but keep the signal).
- `src/api/auth.ts`: retire `getToken/setToken/clearToken` (sessionStorage) —
  or keep the `onAuthCleared`/`emitAuthCleared` **signal bus** (still used) and
  delete only the token storage. Prefer: keep the bus, remove token storage.

**Acceptance:** `client` tests — a 401 emits `authCleared`; requests carry
`credentials:'include'`; no `Authorization` header is added from storage.

---

### Unit 5 — web: `AuthContext` + `LoginGate` speak "password", not "token"

**Where:** `packages/web/src/auth/AuthContext.tsx`, `auth/LoginGate.tsx`.

- `AuthContext.login(password)` now `POST`s `/api/login { password }` instead of
  storing a token + re-checking. On 200 → re-run `/api/auth/check` (now cookie
  is set) → `'authed'`; on 401 → return `false` (gate stays up). Add
  `logout()`: `POST /api/logout` → `'needs-login'`.
- `LoginGate`: reword "Access token" → "Password", the helper copy
  "Enter your access token to continue." → "Enter your password to continue.",
  same card/styles (already Oat, amber-free). `autoComplete="current-password"`
  stays. The "couldn't reach the server" branch stays.

**Acceptance:** `LoginGate.test.tsx` updated — correct password ⇒ app renders;
wrong ⇒ inline error, field retained; the fetch mock asserts a `POST /api/login`
with the password (not a Bearer re-check). `AuthContext` logout ⇒ `needs-login`.

---

### Unit 6 — web: sidebar "Log out" button below Settings

**Where:** `packages/web/src/components/Sidebar.tsx` (+ `NavIcons.tsx` for an
icon).

- A `NavItem` in **button mode** (like Search/Settings — `skipNavigate`, no
  routing), placed directly **below Settings**, labeled "Log out", calling
  `useAuth().logout()`. Only rendered when auth is active (state `'authed'`) —
  hidden entirely in the `'open'` (no-password) deployment so localhost dev
  shows no logout button. Uses the shared `NavItem` styling (no drift — the
  established rule from the Search/Settings rows).

**Acceptance:** browser-QA (below) + a Sidebar test: the button shows only when
authed, and clicking calls `logout`. Visual: matches Settings row exactly.

---

## Env / docs

- `.env.example`: add `SILO_APP_PASSWORD=` and `SILO_SESSION_SECRET=` with
  one-line comments.
- `docs/rules/api-hono.md` "Auth" note: add the cookie branch to the gate
  description.

## Non-goals (parked)

- Multi-user accounts / usernames (single shared password only — Stash model).
- Server-side session store / revocation list (stateless signed cookie; to
  invalidate all sessions, rotate `SILO_SESSION_SECRET`/`SILO_APP_PASSWORD`).
- Rate-limiting the login endpoint (single-user; note as a future hardening).
  This is the dominant practical risk if a *weak* `SILO_APP_PASSWORD` is set —
  online guessing. Mitigation shipped: `.env.example` documents a strong-password
  requirement (≥16 chars / `openssl rand -hex 32`).
- KDF for the signing key: when `SILO_SESSION_SECRET` is unset the login
  password is used verbatim as the HMAC key, so a weak password is also a weak
  MAC key (ce-security P2, confidence 50). Not exploitable offline (forgery
  needs a known plaintext+signature pair the attacker can't obtain), and the
  strong-password doc guidance + the independent-secret option address it in
  practice. A future hardening could derive the MAC key via a KDF (e.g.
  HKDF/scrypt over the password) so a memorable password never becomes a weak
  key; parked as not worth the complexity for a single-user tool today.
- "Remember me" vs. session cookie toggle (fixed ~30-day Max-Age).

## Review + QA plan (binding protocol)

- After each unit: `check-types` + `test` + `quality` green.
- Independent review on the full diff: **security-reviewer** (auth/cookie —
  mandatory), correctness, adversarial (touches auth), + frontend-races if the
  web guard timing looks non-trivial.
- Intense QA against a real running app with `SILO_APP_PASSWORD` set: wrong
  password rejected; correct password ⇒ cookie set ⇒ app; reload stays logged
  in (cookie persists); Log out ⇒ back to `/login`; an extension-style
  `Authorization: Bearer` call still works; **unset password ⇒ no login screen,
  dev unaffected**. Verify the cookie is `HttpOnly` (not readable via
  `document.cookie`) and `SameSite=Lax` in the browser.
- Browser-QA the login card + sidebar Log out button visually (Oat, theme-aware).

## Commit / branch

Per the standing session override: commit straight to `main`, staging by
explicit path, running the full local gate + the security review **before**
each push (the gate that trunk-based flow relies on in place of CI-before-merge).
