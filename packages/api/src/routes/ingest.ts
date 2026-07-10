import type { CreateLinkInput } from '@silo/core';
import type { Hono } from 'hono';
import { checkIngestAuth } from '../ingest-auth.js';
import { type IngestBody, ingestBodySchema } from '../query-schemas.js';
import { performCapture } from './mutate-link.js';

/**
 * Builds a `CreateLinkInput` from a parsed `IngestBody`, conditionally (not
 * via object-literal spread): `exactOptionalPropertyTypes` makes
 * `CreateLinkInput`'s optional fields reject an explicit `undefined`, and
 * Zod's `.optional()` fields come through as `undefined` when the body field
 * is omitted — mirrors `links-write.ts`'s capture handler, which hits the
 * identical constraint. Factored out of the route handler to keep it under
 * the lint's cognitive-complexity ceiling.
 */
function toCreateLinkInput(body: IngestBody): CreateLinkInput {
  const input: CreateLinkInput = {
    url: body.url,
    sourceKind: body.sourceKind ?? 'link',
    origin: 'user',
  };
  if (body.tags !== undefined) input.tags = body.tags;
  if (body.note !== undefined) input.notes = body.note;
  if (body.sourceData !== undefined) input.sourceData = body.sourceData;
  // Capture-source slice: a caller that self-declares (CLI/Raycast/Chrome)
  // gets its own value forwarded; a generic ingest caller that didn't
  // declare one falls back to `'ingest'` (distinct from `POST /api/links`'s
  // `'unknown'` fallback — an ingest call is KNOWN to have come through this
  // trusted seam, even if the specific tool didn't self-identify).
  input.source = body.source ?? 'ingest';
  return input;
}

/**
 * `POST /api/ingest` — the trusted, TOKEN-GATED capture seam for a local
 * ingest tool (CLI foundation slice, plan 020; the `silo ingest x` command
 * itself is a LATER, separate slice — this is only the seam it will call).
 *
 * WHY THIS ROUTE EXISTS, SEPARATE FROM `POST /api/links`: silo cannot fetch
 * a tweet server-side (X blocks it — see `packages/worker/src/enrich-
 * source/index.ts`'s `'twitter'` comment), so a local ingest tool (Field
 * Theory-backed, running on the user's own machine) must supply the
 * pre-extracted `sourceData` AT capture time. `captureBodySchema` (the
 * PUBLIC `POST /api/links` body — `query-schemas.ts`) deliberately does NOT
 * accept `sourceData`, and MUST NOT ever be extended to: that route is
 * reachable by an arbitrary cross-origin web page (no auth on this API — see
 * `docs/rules/api-hono.md`'s "Auth (there is none)" section, still true for
 * every route except this one), and letting ANY caller inject arbitrary
 * `sourceData` would mean a malicious page could forge fake engagement
 * stats, fake "verified" source badges, or oversized payloads onto a
 * victim's store. So `sourceData` gets its OWN endpoint, gated shut by
 * default.
 *
 * THE TRUST GATE (`ingest-auth.ts` — read its module doc comment for the
 * full design rationale, including why this is TOKEN-ALWAYS rather than the
 * plan's preferred "loopback-trusted, token-required-when-exposed"): a
 * request reaches `core.createLink` here ONLY if it presents
 * `Authorization: Bearer <SILO_API_TOKEN>` matching the token configured on
 * this process via env var. If `SILO_API_TOKEN` is unset, this route is
 * UNCONDITIONALLY CLOSED (401 on every request, regardless of header) — it
 * does not fall open on a default localhost setup the way the rest of this
 * unauthenticated API does. Operators must explicitly set `SILO_API_TOKEN`
 * (documented in `.env.example`) before any ingest tool can use this route.
 *
 * THE INVARIANT THIS ROUTE PROVES (ce-security review target): sourceData
 * injection into a stored link is possible ONLY via this route, and only
 * with a valid bearer token — never via the public `POST /api/links` (which
 * has no `sourceData` field in its schema at all — Zod strips it silently as
 * an unrecognized key is NOT how `captureBodySchema` works; it simply has no
 * such field to bind to, so a caller sending `sourceData` in that body has
 * it ignored, not rejected — see `links-write.test.ts`'s regression test),
 * and never without the token (see `ingest.test.ts`'s untrusted-caller
 * cases).
 *
 * BEHAVIOR ONCE AUTHORIZED: goes through `performCapture` (`mutate-link.ts`)
 * — the SAME shared capture tail `POST /api/links` uses (URL guard -> dedup
 * pre-check -> `core.createLink` -> re-fetch/shape/respond `{ link,
 * deduped }`; factored out once this route and `links-write.ts`'s capture
 * handler were near-identical and tripped jscpd). `core.createLink` already
 * accepts and validates `sourceData` against the full `sourceDataSchema`
 * union — no new core write mechanism. Dedup applies identically
 * (re-ingesting an already-captured tweet merges, it does not duplicate).
 * Ingest captures are `origin: 'user'` — matches `POST /api/links`'s own
 * origin choice (`◆` stays reserved for the MCP `capture_link` tool's
 * `agent` origin; an ingest tool acting on the user's own bookmarks is a
 * user action, not an agent one).
 */
export function registerIngestRoutes(app: Hono): void {
  app.post('/ingest', async (c) => {
    const auth = await checkIngestAuth(c);
    if (!auth.ok) {
      // Never distinguish "token not configured" from "wrong/missing token"
      // in the RESPONSE (both are 401 with the same generic message) — that
      // distinction would let a prober learn whether ingest is enabled at
      // all on a reachable-but-unauthenticated host. The operator-relevant
      // detail (`auth.reason`) stays server-side only, in the log line.
      console.error(`[silo/api] /api/ingest rejected: ${auth.reason}`);
      return c.json(
        { error: 'unauthorized', message: 'A valid Authorization: Bearer token is required.' },
        401,
      );
    }

    const body = ingestBodySchema.parse(await c.req.json());
    const input = toCreateLinkInput(body);

    return performCapture(c, input, 'Invalid ingest input');
  });
}
