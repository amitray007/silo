/**
 * The OPTIONAL bearer-token gate for the general API (extensions-base slice,
 * plan 021) — the "prod seam" the Chrome/Raycast extensions and a deployed
 * web UI will use once silo runs somewhere other than localhost.
 *
 * POSTURE (deliberately the OPPOSITE default of `ingest-auth.ts`): WHEN
 * `SILO_API_TOKEN` is unset, this gate is a no-op — every `/api/*` route
 * (except `/api/ingest`, which has its own always-closed gate) stays exactly
 * as reachable as it is today (see `docs/rules/api-hono.md`'s "Auth (there is
 * none)"). This is the correct default for a single-user localhost tool: a
 * developer running `pnpm dev` with no token configured must see NO change
 * in behavior. Only WHEN an operator explicitly sets `SILO_API_TOKEN` (e.g.
 * deploying the API somewhere reachable off-host, per `main.ts`'s `HOST`
 * warning) does every `/api/*` route start requiring
 * `Authorization: Bearer <token>` — the same token configured for
 * `/api/ingest`, reused rather than adding a second env var, since both are
 * "the one shared secret that proves a caller is this deployment's owner".
 *
 * WHY ONE ENV VAR SERVES BOTH GATES: `/api/ingest`'s gate is ALWAYS closed
 * (unset token => 401, no exceptions — see `ingest-auth.ts`) regardless of
 * what this general gate does; this general gate is OPTIONAL (unset token =>
 * open). Reusing `SILO_API_TOKEN` does not weaken either: setting it widens
 * protection (adds the general gate on top of the always-on ingest gate),
 * it never narrows the ingest gate's own closed-by-default posture.
 *
 * SHARED MECHANICS: reuses `token-auth.ts`'s timing-safe compare and
 * Bearer-header parsing — see that module's doc comment for why a naive
 * `===` is unsafe for comparing secrets. Only the env var name and the
 * open/closed default differ between the two gates; that policy difference
 * stays local to each gate's own module (this file vs. `ingest-auth.ts`).
 *
 * `GET /health` is mounted OUTSIDE the `/api` sub-app (see `app.ts`) so it is
 * already exempt by construction — this middleware is only ever attached to
 * the `/api` sub-app, never the root app, so `/health` never passes through
 * it at all.
 *
 * PROD WEB-UI AUTH (noted, not solved here — plan 021 out-of-scope): once a
 * deployment sets `SILO_API_TOKEN`, the web UI's own same-origin calls to
 * `/api/*` must ALSO send the bearer token (or be served from a trusted
 * origin that injects it), or they will start getting 401s the moment the
 * token is set. In localhost dev the token is unset, so the web UI's
 * requests are unaffected — this only bites a real prod deployment, whose
 * web-UI auth story is a separate, later slice.
 */

import type { Context, Next } from 'hono';
import { bearerToken, readTokenEnv, timingSafeEqual } from './token-auth.js';

/** Reads `SILO_API_TOKEN` fresh from the environment on every call — mirrors
 * `ingest-auth.ts`'s `configuredToken`; kept as a separate tiny wrapper
 * (rather than calling `readTokenEnv` inline at each call site) so a future
 * change to which env var the general gate reads touches one line. */
function configuredToken(): string | undefined {
  return readTokenEnv('SILO_API_TOKEN');
}

/**
 * Hono middleware: when `SILO_API_TOKEN` is set, every request must present
 * a matching `Authorization: Bearer <token>` header or gets `401`. When
 * unset, calls `next()` immediately — no auth, exactly today's behavior.
 *
 * Mount this AFTER the CORS middleware on the `/api` sub-app (see `app.ts`)
 * so the ordering is: disallowed origin -> blocked by CORS (no CORS headers,
 * browser refuses the response) before this middleware ever runs; allowed
 * origin + no/bad token -> this middleware's `401`.
 */
export async function generalTokenAuth(c: Context, next: Next): Promise<Response | undefined> {
  const expected = configuredToken();
  if (!expected) {
    await next();
    return undefined;
  }
  const presented = bearerToken(c);
  if (!presented || !timingSafeEqual(presented, expected)) {
    return c.json(
      { error: 'unauthorized', message: 'A valid Authorization: Bearer token is required.' },
      401,
    );
  }
  await next();
  return undefined;
}
