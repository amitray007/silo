/**
 * Shared bearer-token primitives — the token-read + timing-safe compare logic
 * used by BOTH `/api/ingest`'s always-closed gate (`ingest-auth.ts`, plan
 * 020) and the general-API optional token gate (`general-auth.ts`, plan
 * 021). Factored out here so the two gates never duplicate the compare (a
 * naive `===` on a secret leaks timing information — see `timingSafeEqual`
 * below) — jscpd flagged the near-identical pair during plan 021's build.
 *
 * The two gates read DIFFERENT env vars and have DIFFERENT default postures
 * (`/api/ingest` is closed-by-default even when unset; the general gate is
 * open-by-default when unset) — that policy difference stays in each gate's
 * own module. This module only owns the mechanics: "read an env var as a
 * token", "parse a Bearer header", "compare two secrets without leaking
 * timing".
 *
 * `readTokenEnv`/`timingSafeEqual` moved to `@silo/core` (MCP-HTTP slice,
 * U1) so `@silo/app`'s HTTP MCP listener can reuse them without importing
 * this adapter (`@silo/app` may not import `@silo/api` — see
 * docs/rules/architecture.md). Re-exported here VERBATIM so this module's
 * existing call sites (`ingest-auth.ts`, `general-auth.ts`, both importing
 * from `./token-auth.js`) keep working unchanged.
 */

import type { Context } from 'hono';

export { readTokenEnv, timingSafeEqual } from '@silo/core';

/** Parses `Authorization: Bearer <token>`, returning the token or `undefined`
 * if the header is absent or not in the exact `Bearer <token>` form. Hono's
 * `c.req.header()` delegates to the Fetch `Headers` API, whose lookup is
 * spec-mandated case-insensitive, so a single lowercase-key read matches an
 * `Authorization:` header sent with any casing. */
export function bearerToken(c: Context): string | undefined {
  const header = c.req.header('authorization');
  if (!header) return undefined;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1];
}
