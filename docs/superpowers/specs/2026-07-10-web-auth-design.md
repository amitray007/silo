# Web app auth (env-secret password) — design spec

**Status:** decisions locked (user offline; lead made the scoping calls, recorded
for later review) · **Slice:** web auth · **Date:** 2026-07-10

## Goal

Gate the web app behind the **server-side secret** (`SILO_API_TOKEN`) so a
deployed silo isn't wide open. This is the "later slice" `general-auth.ts`
explicitly names: once a deployment sets `SILO_API_TOKEN`, every `/api/*` call
requires `Authorization: Bearer <token>`, so the web UI's own calls start 401ing
unless it sends the token. This slice makes the web UI obtain + send it.

It is also the **linchpin** that makes the import UI (POST /api/import) and the
MCP AccessTab's token story fully work in-browser.

## The core realization

`SILO_API_TOKEN` **is** the "server-side password." There is no separate password
store. The login screen takes the token value, verifies it against the API, holds
it, and `apiFetch` attaches it as a bearer on every `/api/*` call.

## Decisions locked

1. **The token is the password.** The user enters the `SILO_API_TOKEN` value on a
   login screen. No separate credential, no user accounts (single-user store).
2. **No cookies/sessions server-side.** The API stays stateless bearer-auth (no
   new session infra). The browser holds the token client-side and sends it as
   `Authorization: Bearer`.
3. **Auth is CONDITIONAL on the server having a token.** When `SILO_API_TOKEN` is
   UNSET (localhost dev default), `general-auth.ts` is a no-op → the web app shows
   **no login** and works exactly as today. When SET → the web app requires login.
   The web app learns which mode it's in from a new lightweight endpoint (below).
4. **Token storage: `sessionStorage`** (not `localStorage`). It survives reloads
   within the tab/session but not indefinitely — a reasonable default for a
   personal tool (re-login on a fresh session). In memory during the SPA lifetime.
   (Not a cookie — avoids CSRF surface; bearer-in-header is not auto-sent.)
5. **A dedicated auth endpoint** `GET /api/auth/check` (see below) — cleaner than
   probing `/api/counts`, and it can report the "is auth even required" mode
   without leaking data.

## Architecture

### 1. `@silo/api` — `GET /api/auth/check` (build FIRST)

A tiny endpoint the web app calls to (a) learn if auth is required and (b)
validate a token. Two sub-cases:

- **Mount it OUTSIDE `generalTokenAuth`** (like `/health`) so it's always
  reachable, and have it inspect the token state itself:
  - `readTokenEnv('SILO_API_TOKEN')` unset → `{ authRequired: false }` (200). The
    web app knows no login is needed.
  - Token set + request carries a VALID `Authorization: Bearer <token>` →
    `{ authRequired: true, authenticated: true }` (200).
  - Token set + missing/invalid bearer → `{ authRequired: true, authenticated: false }`
    (200 — NOT 401; this endpoint reports status, it doesn't gate. It reveals only
    "auth is on" which is already obvious to a legitimate operator, and never
    leaks whether a *specific* token guess is right vs the timing-safe compare).
  - Uses core's `timingSafeEqual` + `bearerToken` for the check (reuse the API's
    existing `token-auth.ts` helpers — `bearerToken` + the core primitives).
- This route does NOT touch the DB. It's pure auth-state introspection.
- Register it on the ROOT app (alongside `/health`), not the guarded `/api`
  sub-app — OR register on `/api` but BEFORE the `generalTokenAuth` middleware. The
  cleanest: a route on the root app at `/api/auth/check` mounted before the sub-app
  guard, or its own tiny handler. (Implementer: pick whichever keeps it reachable
  without a token; document it.)

### 2. `@silo/web` — attach bearer in `apiFetch` (build SECOND)

- A tiny auth module `packages/web/src/api/auth.ts`:
  - `getToken(): string | null` / `setToken(t: string): void` / `clearToken(): void`
    — backed by `sessionStorage` (key e.g. `silo.apiToken`) + an in-memory cache.
- `apiFetch` (`packages/web/src/api/client.ts`): when a token is present, add
  `Authorization: Bearer <token>` to the request headers (merge with any existing
  init headers). This is the SINGLE injection point — every `apiGet`/`apiPost`/etc.
  flows through `apiFetch`, so this one change makes ALL calls (including import's
  POST) carry the token.
- **401 handling:** when any `apiFetch` response is 401, `clearToken()` and signal
  the app to show the login gate (e.g. dispatch an event / a small auth store the
  gate subscribes to). A token that goes stale mid-session bounces to login.

### 3. `@silo/web` — the login gate (build THIRD)

- An auth store/context (`packages/web/src/auth/AuthContext.tsx` or similar):
  - On app mount, call `GET /api/auth/check`:
    - `authRequired: false` → app renders normally (no login), forever this session.
    - `authRequired: true, authenticated: true` (a stored token validated) → render app.
    - `authRequired: true, authenticated: false` → render the **LoginGate**.
- `LoginGate` component (Oat-styled): a centered card — silo brand dot, a single
  password field ("Enter your silo access token"), a submit button. On submit:
  `setToken(value)`, re-call `/api/auth/check` with the bearer; on
  `authenticated: true` → enter the app; on false → show an inline "That token
  didn't work" error, clear the bad token. No account creation, no recovery flow.
- Mount the gate around `<Routes>` (in `App.tsx` or `main.tsx`): the gate decides
  whether to render the routes or the login card.
- Design: Geist, Oat tokens, the amber brand dot, calm. A login screen, not a
  marketing page. Reuse existing modal/card chrome where sensible.

## Interaction with the other slices (the payoff)

Once this lands:
- **Import UI:** the import POST now carries the bearer automatically (via
  `apiFetch`), so the "Import needs a server token" 401 message path is replaced by
  a working import when the user is logged in.
- **MCP AccessTab:** unchanged (the MCP config still uses a placeholder token the
  user fills in for their MCP *client* — a separate concern from the web session).
  But the web app itself is now gated consistently.

## Out of scope (parked)

- User accounts / multi-user / roles (single shared secret).
- Password reset / recovery (it's an env secret — the operator changes the env).
- Server-side sessions / cookies / refresh tokens.
- Remember-me beyond the tab session (sessionStorage is the deliberate choice).
- Rate-limiting login attempts (timing-safe compare + a single-user local tool;
  note it as a possible future hardening, don't build it).

## Testing

- **api** (`/api/auth/check`): unset token → `{authRequired:false}`; set token + no
  bearer → `{authRequired:true, authenticated:false}`; set token + valid bearer →
  `{authRequired:true, authenticated:true}`; set token + wrong bearer →
  `authenticated:false`. Never 401 (it's a status probe). Reachable without a token.
- **web** (`auth.ts`): token get/set/clear round-trips sessionStorage; `apiFetch`
  attaches the bearer when a token is present, omits it when absent; a 401 response
  clears the token.
- **web** (LoginGate + AuthContext): `authRequired:false` → no gate, app renders;
  `authRequired:true`+no token → gate shown; submitting a valid token enters the
  app; a wrong token shows the error and stays on the gate; a mid-session 401
  bounces back to the gate.
- Full review protocol (security central — it's the app's auth gate) + real-infra
  QA: run the API + web with `SILO_API_TOKEN` set → confirm login required, valid
  token enters, wrong token rejected, import now works post-login; run with the
  token UNSET → confirm NO login (localhost dev unchanged). Browser-QA the login
  screen.

## Decisions summary

- `SILO_API_TOKEN` is the password; enter it → validate → hold in sessionStorage →
  `apiFetch` attaches bearer on every call.
- New `GET /api/auth/check` (ungated status probe) reports authRequired + authenticated.
- Conditional: no login when the server token is unset (localhost unchanged).
- 401 anywhere → clear token → bounce to login gate.
- Oat-styled single-field login; no accounts/recovery/sessions.
