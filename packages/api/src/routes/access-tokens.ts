import {
  generateAccessToken,
  InvalidAccessTokenNameError,
  listAccessTokens,
  listOAuthClientsForOwner,
  revokeAccessToken,
  revokeAllOAuthClients,
  revokeOAuthClient,
} from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';

/** `POST /api/access-tokens` body schema — a name only; core trims/validates blankness (this Zod check is defense-in-depth so most bad input never reaches core). */
const createBodySchema = z.object({
  name: z.string().min(1).max(100),
});

/** `DELETE /api/access-tokens/:id` param schema — a non-uuid id is a 400, not a pointless DB round-trip (mirrors `links-write.ts`'s `idParamSchema`). */
const idParamSchema = z.object({ id: z.uuid() });

/** `DELETE /api/access-tokens/oauth-clients/:clientId` param schema — a
 * `cli_` id is opaque (not a uuid, see OAUTH-INTERFACES.md), so this only
 * guards against an empty path segment; an unknown-but-well-formed id is a
 * harmless no-op (`revokeOAuthClient` deletes zero rows silently — see its
 * doc comment), not a 404, matching how `revokeAllOAuthClients` has no
 * not-found case either. */
const clientIdParamSchema = z.object({ clientId: z.string().min(1) });

/**
 * Registers the access-token MANAGEMENT routes (access-tokens slice, U3):
 * create/list/revoke named DB-backed access tokens over `core.
 * generateAccessToken`/`listAccessTokens`/`revokeAccessToken`. Mounted on the
 * `api` sub-app in `app.ts` (same as every other `/api/*` route) — that
 * sub-app is guarded by `generalTokenAuth`, so managing tokens itself
 * requires a valid bearer (env token OR an existing DB token) whenever
 * `SILO_API_TOKEN` is configured. No separate auth layer needed here.
 */
export function registerAccessTokenRoutes(app: Hono): void {
  /**
   * `GET /api/access-tokens` — list every token, WITHOUT secrets. `core.
   * listAccessTokens` already selects only id/name/prefix/createdAt/
   * lastUsedAt (never the hash) — this route is a pure passthrough.
   */
  app.get('/access-tokens', async (c) => {
    const tokens = await listAccessTokens();
    return c.json({ tokens });
  });

  /**
   * `POST /api/access-tokens` — mint a new token. Body: `{ name }`. Returns
   * `201` with the RAW token (the only time it's ever visible) alongside
   * `id`/`name`/`prefix`/`createdAt`. `InvalidAccessTokenNameError` is caught
   * for defense-in-depth (the Zod `min(1)` above already rejects an empty
   * string; core additionally rejects a whitespace-only name after trim).
   */
  app.post('/access-tokens', async (c) => {
    const body = createBodySchema.parse(await c.req.json());

    try {
      const created = await generateAccessToken(body.name);
      return c.json(
        {
          id: created.id,
          name: created.name,
          token: created.token,
          prefix: created.prefix,
          createdAt: created.createdAt,
        },
        201,
      );
    } catch (error) {
      if (error instanceof InvalidAccessTokenNameError) {
        return c.json({ error: 'validation_error', message: error.message }, 400);
      }
      throw error;
    }
  });

  /**
   * `GET /api/access-tokens/oauth-clients` — connected-apps list (MCP OAuth
   * slice, U2), owner-only management, GATED like every other route in this
   * file (mounted on the `api` sub-app, under `generalTokenAuth`). Pure
   * passthrough of `core.listOAuthClientsForOwner()` — already deduped by
   * client name, sorted most-recently-granted first (see
   * `OAUTH-INTERFACES.md`). Response: `{ clients: ConnectedOAuthClient[] }`,
   * each entry `{ clientName, clientIds, grantedAt, lastUsedAt,
   * activeTokenCount, connectionCount }` (dates serialize to ISO strings over
   * JSON, same as every other timestamp field this API returns).
   *
   * Registered BEFORE `DELETE /access-tokens/:id` below — Hono matches
   * routes in REGISTRATION order among equally-specific patterns, so the
   * static `/access-tokens/oauth-clients(/:clientId)` paths must come first
   * or a request for them would instead match `/:id` (and 400 on the
   * `z.uuid()` param parse, since `oauth-clients` isn't a uuid) before ever
   * reaching these handlers. Verified by this file's own route tests.
   */
  app.get('/access-tokens/oauth-clients', async (c) => {
    const clients = await listOAuthClientsForOwner();
    return c.json({ clients });
  });

  /**
   * `DELETE /api/access-tokens/oauth-clients` — revoke ALL connected OAuth
   * clients' tokens in one call (the settings UI's "Revoke all" action).
   * Leaves `kind='bearer'` tokens (the manual/DB-token path) completely
   * untouched — see `core.revokeAllOAuthClients`'s doc comment. Always
   * `204`. Registered BEFORE `/access-tokens/oauth-clients/:clientId` for
   * the same static-before-param reason as above (both are static-vs-param
   * siblings under the same prefix).
   */
  app.delete('/access-tokens/oauth-clients', async (c) => {
    await revokeAllOAuthClients();
    return c.body(null, 204);
  });

  /**
   * `DELETE /api/access-tokens/oauth-clients/:clientId` — revoke ONE
   * `cli_*` client id's tokens. The web UI fans this out over every id in a
   * deduped `ConnectedOAuthClient.clientIds` group to fully revoke a
   * re-registration-noise group (see `OAUTH-INTERFACES.md`'s
   * `revokeOAuthClient` doc comment) — this route itself only ever touches
   * the one id it's given. Always `204`, even for an unknown/already-revoked
   * id: `revokeOAuthClient` deletes zero rows silently in that case, which is
   * indistinguishable from (and just as successful as) "already revoked" —
   * mirrors `revokeAllOAuthClients` having no not-found case either, rather
   * than `DELETE /api/access-tokens/:id`'s 404 (that route's id space is a
   * single row per delete with a meaningful "was it there" answer; an OAuth
   * client id fanned out in bulk from the UI has no such single-row
   * expectation).
   */
  app.delete('/access-tokens/oauth-clients/:clientId', async (c) => {
    const { clientId } = clientIdParamSchema.parse({ clientId: c.req.param('clientId') });
    await revokeOAuthClient(clientId);
    return c.body(null, 204);
  });

  /**
   * `DELETE /api/access-tokens/:id` — revoke. `204` if a row was actually
   * deleted, `404` if the id was unknown/already revoked. Registered LAST
   * among the delete routes — see the `oauth-clients` routes above for why
   * order matters here.
   */
  app.delete('/access-tokens/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });

    const ok = await revokeAccessToken(id);
    if (!ok) {
      return c.json({ error: 'not_found', message: `No access token with id ${id}` }, 404);
    }
    return c.body(null, 204);
  });
}
