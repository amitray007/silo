# Method file — Web app auth (env-secret password gate)

**Spec:** `docs/superpowers/specs/2026-07-10-web-auth-design.md`.
**Branch/worktree:** `slice/command-center` @ `.claude/worktrees/command-center`.
**Builder:** Sonnet. **Rules:** `docs/rules/` (api-hono, web-react, typescript, testing).
`exactOptionalPropertyTypes` ON.

Final slice. `SILO_API_TOKEN` is the "server-side password." Makes the import UI +
MCP token story work in-browser.

## Conventions to mirror (verified)

- `packages/api/src/app.ts`: `/health` is on the ROOT app (line ~68), the `/api`
  sub-app has `api.use('*', generalTokenAuth)` (line ~79) then routes, mounted at
  `app.route('/api', api)` (line ~91). Error envelope `{ error, message, details? }`.
- `packages/api/src/token-auth.ts`: `bearerToken(c)` (hono), + re-exported
  `timingSafeEqual`/`readTokenEnv` from `@silo/core`.
- `packages/web/src/api/client.ts`: `apiFetch(path, init)` (~line 130) is the
  single fetch chokepoint; `baseUrl`; `ApiError` carries `.status`.
- `packages/web/src/main.tsx` (`<BrowserRouter>`) + `App.tsx` (`<Routes>`) — where
  the gate mounts.
- Web CANNOT import `@silo/core` (pulls in pg) — the auth-check response shape is
  hand-typed in web.

---

## Unit 1 — `@silo/api`: `GET /api/auth/check` (ungated status probe; build FIRST)

- New file `packages/api/src/routes/auth.ts`, `registerAuthRoutes(app: Hono)`.
- **Must be reachable WITHOUT a token** — so it must NOT sit behind
  `generalTokenAuth`. Register it on the ROOT `app` at the full path
  `/api/auth/check` (NOT on the guarded `api` sub-app). In `app.ts`, call
  `registerAuthRoutes(app)` (the root app, like `/health`), BEFORE or independent
  of the `/api` sub-app mount. Since the sub-app is mounted at `/api`, adding
  `app.get('/api/auth/check', ...)` on the root app must be registered so it wins /
  is reachable — verify Hono routes the exact path on the root before delegating to
  the sub-app for other `/api/*`. (If the sub-app mount would swallow
  `/api/auth/check`, register the auth route on the root app BEFORE
  `app.route('/api', api)`. Confirm with the test.)
- Handler logic:
  ```
  const expected = readTokenEnv('SILO_API_TOKEN');
  if (!expected) return c.json({ authRequired: false });
  const presented = bearerToken(c);
  const authenticated = !!presented && timingSafeEqual(presented, expected);
  return c.json({ authRequired: true, authenticated });
  ```
  (import `readTokenEnv`, `timingSafeEqual` from `@silo/core` or via
  `token-auth.js`; `bearerToken` from `token-auth.js`.)
- ALWAYS 200 — never 401. It reports state, doesn't gate. No DB access.
- Tests `packages/api/src/routes/auth.test.ts`: token unset →
  `{authRequired:false}`; token set + no Authorization → `{authRequired:true,
  authenticated:false}`; token set + correct bearer → `{authRequired:true,
  authenticated:true}`; token set + wrong bearer → `authenticated:false`; ALL 200.
  Reachable with no token (that's the point). Set/restore `SILO_API_TOKEN` per test
  (mirror general-auth.test.ts, restore after). Confirm the route is reachable even
  when `SILO_API_TOKEN` is set (i.e. it is NOT behind the gate).

Gate `--filter=@silo/api`. Commit: `feat(api): GET /api/auth/check (ungated auth-state probe)`.

---

## Unit 2 — `@silo/web`: token storage + `apiFetch` bearer + 401 handling (build SECOND)

- New file `packages/web/src/api/auth.ts`:
  - sessionStorage-backed token (key `silo.apiToken`) + in-memory cache:
    `getToken(): string | null`, `setToken(t: string): void`, `clearToken(): void`.
    Guard against sessionStorage being unavailable (SSR/private mode) — try/catch,
    fall back to memory-only.
  - A tiny pub/sub or event so the login gate can react to `clearToken()` from a
    401 (e.g. `onAuthCleared(cb)` / a `window` CustomEvent `silo:auth-cleared`, or
    a small module-level listener set). Keep it minimal.
- Edit `packages/web/src/api/client.ts` `apiFetch`: before the `fetch`, if
  `getToken()` is non-null, merge `Authorization: Bearer <token>` into
  `init.headers` (preserve any existing headers — e.g. the JSON content-type on
  POSTs). This one change makes EVERY verb carry the token.
- In `apiFetch`, after getting the response: if `response.status === 401`, call
  `clearToken()` (and fire the auth-cleared signal) so a stale token bounces the
  user to login. (Do this before the existing error handling so the token is
  cleared regardless of how the caller handles the error.)
- Tests (`auth.test.ts` + extend `client.test.ts`): token get/set/clear
  round-trips; `apiFetch` includes the bearer when a token is set and omits it when
  null; existing headers (content-type) survive the merge; a 401 response clears
  the token + fires the signal. Mock fetch/sessionStorage per existing patterns.

Gate `--filter=@silo/web`. Commit: `feat(web): attach bearer token in apiFetch, clear on 401`.

---

## Unit 3 — `@silo/web`: AuthContext + LoginGate (build THIRD)

- New `packages/web/src/auth/AuthContext.tsx`:
  - On mount, `fetch(apiUrl('/api/auth/check'))` (with the current token if any —
    via apiFetch so the bearer is attached). Parse `{ authRequired, authenticated }`
    (hand-typed shape). Compute a state: `'loading' | 'open' (no auth needed) |
    'authed' | 'needs-login'`.
    - `authRequired:false` → `'open'`.
    - `authRequired:true && authenticated:true` → `'authed'`.
    - `authRequired:true && authenticated:false` → `'needs-login'`.
  - Subscribe to the auth-cleared signal from Unit 2 → on 401 anywhere, transition
    to `'needs-login'`.
  - Expose `login(token: string): Promise<boolean>` → `setToken(token)`, re-call
    `/api/auth/check`, return whether `authenticated`; on false, `clearToken()`.
- New `packages/web/src/auth/LoginGate.tsx` (Oat-styled):
  - Centered card: the silo brand dot (amber), a heading ("silo"), one password
    `<input type="password">` labeled "Access token", a submit button. On submit →
    `login(value)`; on false → inline error "That token didn't work." (calm, muted);
    on true → the app renders (context transitions to `'authed'`).
  - Loading state while the initial `/api/auth/check` is in flight (a calm spinner
    or nothing — avoid flashing the login card before we know the mode).
  - Design: Geist 400/500, Oat tokens, amber only as the brand dot. No marketing
    chrome. Reuse `ModalShell`/card styles if they fit; else a simple centered card.
- Wire in `App.tsx` (or `main.tsx`): wrap `<Routes>` so:
  - `'loading'` → render nothing / a minimal loader.
  - `'open'` or `'authed'` → render the app (`<Routes>`).
  - `'needs-login'` → render `<LoginGate>` instead of the routes.
  - `AuthProvider` goes high in the tree (around the router content), inside
    providers it needs (it uses the api client).
- Tests: AuthContext state machine (each of the 3 modes from a mocked
  `/api/auth/check`); LoginGate renders on `needs-login`, a valid token enters the
  app, a wrong token shows the error + stays; a mid-session auth-cleared event
  shows the gate. Follow existing web test patterns (Testing Library, mock fetch).

Gate `--filter=@silo/web`. Commit: `feat(web): login gate + auth context (env-secret password)`.

---

## Final integration + review (lead)

1. Full-tree gate + `pnpm quality` + dep-cruiser green.
2. `ce-code-review`: SECURITY (this is the app's auth gate — central: the
   auth-check-not-an-oracle property, token storage choice, 401 handling, no bypass
   of the gate) + correctness + api-contract. Resolve findings.
3. Real-infra QA:
   - API + web with `SILO_API_TOKEN` set → web shows the login gate; wrong token →
     error; correct token → app loads; then IMPORT works post-login (the payoff:
     the import POST now carries the bearer); a manual 401 (clear token) bounces to
     login. Browser-QA the login screen visuals.
   - API + web with `SILO_API_TOKEN` UNSET → NO login, app loads directly (localhost
     dev behavior unchanged). This regression check is critical.
4. Do NOT merge to main.

## `.env.example`

`SILO_API_TOKEN` is already documented. Add a one-line note to its block that
setting it now ALSO gates the web UI (a login screen appears) — closing the
"web-UI auth story" the existing comment defers.
