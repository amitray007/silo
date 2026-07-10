import {
  generateAccessToken,
  InvalidAccessTokenNameError,
  listAccessTokens,
  revokeAccessToken,
} from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';

/** `POST /api/access-tokens` body schema — a name only; core trims/validates blankness (this Zod check is defense-in-depth so most bad input never reaches core). */
const createBodySchema = z.object({
  name: z.string().min(1).max(100),
});

/** `DELETE /api/access-tokens/:id` param schema — a non-uuid id is a 400, not a pointless DB round-trip (mirrors `links-write.ts`'s `idParamSchema`). */
const idParamSchema = z.object({ id: z.uuid() });

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
   * `DELETE /api/access-tokens/:id` — revoke. `204` if a row was actually
   * deleted, `404` if the id was unknown/already revoked.
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
