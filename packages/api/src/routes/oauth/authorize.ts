import {
  canonicalMcpResource,
  createAuthCode,
  getOAuthClient,
  readAppPassword,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_VALUE,
  SESSION_MAX_AGE_SECONDS,
  sessionSecret,
  verifyAppPassword,
} from '@silo/core';
import type { Context, Hono } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { z } from 'zod';

/**
 * Shared inline styles for every HTML page this route renders — the Oat
 * design tokens (`docs/design/tokens.md`), dark theme only (an unauthenticated
 * handshake page has no theme toggle to honor, and stash's reference pages are
 * dark-only too). Self-contained (`c.html()` per the design doc — no build
 * step, no asset pipeline reaches this server-rendered surface), so this is a
 * plain CSS string rather than importing `tokens.css` (that file assumes a
 * bundler + both light/dark blocks selected by a runtime class).
 */
const PAGE_STYLES = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #171310;
    color: #ede5d8;
  }
  .card {
    width: 100%;
    max-width: 420px;
    background: #201a15;
    border: 1px solid #2c251d;
    border-radius: 12px;
    padding: 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  h1 {
    font-size: 15px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #a89a87;
    margin: 0;
  }
  p { margin: 0; font-size: 14px; line-height: 1.5; color: #ede5d8; }
  p.muted { color: #a89a87; }
  strong { font-weight: 500; color: #ede5d8; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  label { font-size: 13px; color: #a89a87; }
  input {
    font-family: inherit;
    font-size: 14px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #2c251d;
    background: #171310;
    color: #ede5d8;
  }
  input:focus { outline: 2px solid #6e6353; outline-offset: 1px; }
  .actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }
  button {
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    padding: 9px 16px;
    border-radius: 8px;
    border: 1px solid transparent;
    cursor: pointer;
  }
  button.primary { background: #ede5d8; color: #171310; }
  button.secondary { background: transparent; color: #a89a87; border-color: #2c251d; }
  .error { color: #d9a441; font-size: 14px; line-height: 1.5; }
`;

function htmlShell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${PAGE_STYLES}</style></head><body>${body}</body></html>`;
}

function renderError(message: string): string {
  return htmlShell(
    'silo — authorization error',
    `<div class="card"><h1>Authorization error</h1><p class="error">${escapeHtml(message)}</p></div>`,
  );
}

function renderLogin(query: string, error?: string): string {
  return htmlShell(
    'silo — sign in',
    `<div class="card">
      <h1>Sign in to silo</h1>
      <p class="muted">Sign in to approve this app's access to your silo library.</p>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
      <form method="POST" action="/oauth/authorize/login?${escapeHtml(query)}">
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autofocus required />
        </div>
        <div class="actions">
          <button class="primary" type="submit">Sign in</button>
        </div>
      </form>
    </div>`,
  );
}

function renderConsent(clientName: string, query: string): string {
  return htmlShell(
    'silo — authorize',
    `<div class="card">
      <h1>Authorization request</h1>
      <p><strong>${escapeHtml(clientName)}</strong> is requesting access to your silo library.</p>
      <form method="POST" action="/oauth/authorize?${escapeHtml(query)}">
        <div class="actions">
          <button class="secondary" type="submit" name="decision" value="deny">Deny</button>
          <button class="primary" type="submit" name="decision" value="approve">Approve</button>
        </div>
      </form>
    </div>`,
  );
}

/** Minimal HTML-escape for the handful of values this route interpolates
 * (client name, error text, the re-posted query string) — no templating
 * library is pulled in for four call sites. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const authorizeQuerySchema = z.object({
  response_type: z.string().optional(),
  client_id: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  scope: z.string().optional(),
  state: z.string().optional(),
  resource: z.string().optional(),
});

type AuthorizeParams = z.infer<typeof authorizeQuerySchema>;

type ValidatedAuthorize = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state: string;
  resource: string;
  clientName: string;
};

/**
 * Validates every `/oauth/authorize` param BEFORE any redirect is possible —
 * the open-redirector guard (design doc, "Edge cases"). Returns either the
 * validated, client-checked params or a rendered error page. NEVER redirects
 * on failure; an attacker who controls `redirect_uri` must not be able to
 * bounce a victim's browser anywhere until BOTH the client_id is known AND
 * the redirect_uri is on that client's own registered allowlist.
 */
async function validateAuthorizeParams(
  c: Context,
  params: AuthorizeParams,
): Promise<{ ok: true; value: ValidatedAuthorize } | { ok: false; response: Response }> {
  const {
    response_type: responseType,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    scope = 'silo',
    state = '',
    resource,
  } = params;

  if (!clientId || !redirectUri || !codeChallenge) {
    return {
      ok: false,
      response: c.html(
        renderError('Missing required OAuth parameters (client_id, redirect_uri, code_challenge).'),
        400,
      ),
    };
  }

  if (responseType !== 'code') {
    return {
      ok: false,
      response: c.html(
        renderError(
          `Unsupported response_type: ${responseType ?? '(missing)'}. Only 'code' is supported.`,
        ),
        400,
      ),
    };
  }

  if (codeChallengeMethod !== 'S256') {
    return {
      ok: false,
      response: c.html(
        renderError(
          `Unsupported code_challenge_method: ${codeChallengeMethod ?? '(missing)'}. Only 'S256' is supported.`,
        ),
        400,
      ),
    };
  }

  const publicMcpUrl = process.env.SILO_PUBLIC_MCP_URL?.trim();
  const canonicalResource = publicMcpUrl ? canonicalMcpResource(publicMcpUrl) : undefined;
  const normalizedResource = resource?.replace(/\/$/, '');
  if (!canonicalResource || !normalizedResource || normalizedResource !== canonicalResource) {
    return {
      ok: false,
      response: c.html(renderError("Missing or invalid 'resource' parameter (RFC 8707)."), 400),
    };
  }

  // Client + redirect_uri allowlist checked LAST, and never redirected on
  // failure — this is the open-redirector guard itself: an unknown client or
  // a redirect_uri not on that client's own registered list gets an error
  // PAGE, never a 302 to attacker-controlled input.
  const client = await getOAuthClient(clientId);
  if (!client) {
    return { ok: false, response: c.html(renderError(`Unknown client_id: ${clientId}`), 400) };
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      response: c.html(renderError('redirect_uri is not registered for this client.'), 400),
    };
  }

  return {
    ok: true,
    value: {
      clientId,
      redirectUri,
      codeChallenge,
      scope,
      state,
      resource: normalizedResource,
      clientName: client.name,
    },
  };
}

/** Whether the request carries a valid `silo_session` cookie — identical
 * check to `general-auth.ts`'s `hasValidSessionCookie`/`/api/auth/check`
 * (see `authorize.ts`'s module doc comment: this MUST match exactly, since a
 * user who is already logged into the silo web app should not be re-prompted
 * here). Kept local rather than imported: it's four lines over Hono's own
 * `getSignedCookie`, and importing a `@silo/api`-internal helper across
 * route files isn't this codebase's pattern (each route module composes
 * directly over `@silo/core`'s primitives — see `login.ts`/`auth.ts`). */
async function hasValidSessionCookie(c: Context): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret) return false;
  const value = await getSignedCookie(c, secret, SESSION_COOKIE_NAME);
  return value === SESSION_COOKIE_VALUE;
}

/** Re-serializes the validated params back into a query string, for the
 * login form's `action` and for re-rendering consent after a successful
 * login — carries the FULL original request through the login round-trip
 * without any server-side state (mirrors stash's `?next=` encoding, but kept
 * same-origin/same-route per the design doc rather than a separate `/login`
 * page). */
function toQueryString(v: ValidatedAuthorize): string {
  return new URLSearchParams({
    response_type: 'code',
    client_id: v.clientId,
    redirect_uri: v.redirectUri,
    code_challenge: v.codeChallenge,
    code_challenge_method: 'S256',
    scope: v.scope,
    state: v.state,
    resource: v.resource,
  }).toString();
}

/** Parses + validates this request's `/oauth/authorize` query params
 * (shared by all three handlers below — GET, the login-form POST, and the
 * decision POST all need the SAME validated params before doing anything
 * handler-specific), and pre-computes the re-postable query string. Split
 * out to keep the three handlers' shared prologue in one place rather than
 * three near-identical copies. */
async function parseAndValidate(
  c: Context,
): Promise<
  { ok: true; value: ValidatedAuthorize; query: string } | { ok: false; response: Response }
> {
  const params = authorizeQuerySchema.parse(c.req.query());
  const validated = await validateAuthorizeParams(c, params);
  if (!validated.ok) return validated;
  return { ok: true, value: validated.value, query: toQueryString(validated.value) };
}

/** Validates params, then requires a valid session cookie — the shared
 * prologue of `GET /oauth/authorize` and `POST /oauth/authorize` (the
 * decision handler): both need "validated params + a confirmed session"
 * before doing their own handler-specific work (render consent / act on the
 * decision), and both fall back to the SAME two responses on failure
 * (`validateAuthorizeParams`'s error page, or the login prompt). Returns the
 * validated params + query string on success, or the `Response` to return
 * immediately on either failure. */
async function requireSession(
  c: Context,
): Promise<
  { ok: true; value: ValidatedAuthorize; query: string } | { ok: false; response: Response }
> {
  const validated = await parseAndValidate(c);
  if (!validated.ok) return validated;

  if (!(await hasValidSessionCookie(c))) {
    return { ok: false, response: c.html(renderLogin(validated.query)) };
  }
  return validated;
}

/**
 * Registers `GET`/`POST /oauth/authorize` and the login-form handler `POST
 * /oauth/authorize/login`. Registered on the ROOT app in `app.ts`, wrapped in
 * `oauthCorsMiddleware()` — though in practice this route is reached by a
 * top-level browser navigation (the OAuth redirect flow), not a fetch, so
 * CORS headers are mostly inert here; wrapped anyway for consistency with the
 * rest of the OAuth surface and in case a client probes it via fetch first.
 *
 * `GET /oauth/authorize` — validate-then-branch:
 * 1. `validateAuthorizeParams` (open-redirector guard — see its doc comment).
 * 2. No valid `silo_session` cookie -> render the login prompt (self-posts to
 *    `POST /oauth/authorize/login`, same-origin, no SPA).
 * 3. Valid cookie -> render the consent screen (Approve/Deny form posting to
 *    `POST /oauth/authorize`).
 *
 * `POST /oauth/authorize/login` — verifies the password via
 * `verifyAppPassword` (same check `POST /api/login` uses), sets the SAME
 * `silo_session` cookie via the SAME `setSignedCookie` call as `login.ts`
 * (kept independent rather than imported — see that module's `isHttpsRequest`
 * inlined here too), then re-renders the consent screen for the ORIGINAL
 * query params (no redirect round-trip: the params were carried in the
 * login form's own `action` query string). Wrong password -> re-renders the
 * login prompt with an error, same query string preserved.
 *
 * `POST /oauth/authorize` (decision) — re-validates params (defense in
 * depth: a client_id/redirect_uri could theoretically be revoked between GET
 * and POST) and re-checks the session cookie (a stale form submitted after
 * logout must not silently approve). `decision=approve` ->
 * `createAuthCode` -> `302` to `redirect_uri?code=...&state=...`.
 * `decision=deny` -> `302` to `redirect_uri?error=access_denied&state=...`.
 * These ARE real redirects, but only ever to the SAME `redirect_uri` that
 * was already validated against the client's allowlist in this same
 * request — never attacker-controlled at this point.
 */
export function registerOAuthAuthorizeRoutes(app: Hono): void {
  app.get('/oauth/authorize', async (c) => {
    const session = await requireSession(c);
    if (!session.ok) return session.response;
    return c.html(renderConsent(session.value.clientName, session.query));
  });

  app.post('/oauth/authorize/login', async (c) => {
    const validated = await parseAndValidate(c);
    if (!validated.ok) return validated.response;

    const query = validated.query;

    if (!readAppPassword()) {
      return c.html(renderLogin(query, 'Login is not configured on this deployment.'), 400);
    }

    const form = await c.req.parseBody();
    const password = typeof form.password === 'string' ? form.password : '';
    if (!verifyAppPassword(password)) {
      return c.html(renderLogin(query, 'Incorrect password.'), 401);
    }

    const secret = sessionSecret();
    if (!secret) {
      throw new Error('sessionSecret() unexpectedly undefined with SILO_APP_PASSWORD set');
    }
    const isHttps =
      new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
    await setSignedCookie(c, SESSION_COOKIE_NAME, SESSION_COOKIE_VALUE, secret, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: isHttps,
      // Match `login.ts` exactly — without maxAge the browser treats this as a
      // session-only cookie (cleared on close), giving the OAuth-consent login
      // path a shorter-lived, inconsistent session than the normal web login.
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return c.html(renderConsent(validated.value.clientName, query));
  });

  app.post('/oauth/authorize', async (c) => {
    // Shares `requireSession` with `GET /oauth/authorize` above: same
    // "validated params + confirmed session, or bail with the right error/
    // login response" prologue — a stale form submitted after logout must
    // not silently approve, hence re-checking the cookie here rather than
    // trusting that the GET which rendered this form already confirmed it.
    const session = await requireSession(c);
    if (!session.ok) return session.response;

    const form = await c.req.parseBody();
    const decision = typeof form.decision === 'string' ? form.decision : '';
    const { redirectUri, state } = session.value;

    if (decision === 'approve') {
      const code = await createAuthCode({
        clientId: session.value.clientId,
        redirectUri,
        codeChallenge: session.value.codeChallenge,
        codeChallengeMethod: 'S256',
        scope: session.value.scope,
        resource: session.value.resource,
      });
      const dest = new URL(redirectUri);
      dest.searchParams.set('code', code);
      if (state) dest.searchParams.set('state', state);
      return c.redirect(dest.toString(), 302);
    }

    const dest = new URL(redirectUri);
    dest.searchParams.set('error', 'access_denied');
    if (state) dest.searchParams.set('state', state);
    return c.redirect(dest.toString(), 302);
  });
}
