import { getAllSettings, updateSettings } from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';

/**
 * `PATCH /api/settings` body schema — every field OPTIONAL (an empty body is
 * a valid no-op, same discipline as `editBodySchema`), so a caller can
 * update just `theme`, or just `plugins`, without resending the whole map.
 * Mirrors `@silo/core`'s `settingsSchema` allowlist (`packages/core/src/
 * settings/schema.ts`) field-for-field at the edge — this is the ONE place
 * that shape is duplicated (not imported) because `core`'s schema is a
 * per-key map keyed for `parseSettingValue`, not a single request-body
 * shape; keeping a small, explicit body schema here means a malformed
 * request 400s at the edge (Zod) before ever reaching `core`, same as every
 * other route's body validation. `core.updateSettings` re-validates each
 * field against its OWN schema regardless (defense in depth — the two
 * schemas are kept in sync by hand, same tradeoff `docs/rules/api-hono.md`
 * already accepts for `link-json.ts`'s duplicated whitelist vs `mcp-server`'s).
 *
 * `.strict()` on `plugins` so an unknown plugin key 400s here rather than
 * reaching `core.updateSettings`, which would reject it too (defense in
 * depth, not the only guard).
 */
const settingsPatchBodySchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).optional(),
    trashPurgeDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
    // Access-tab MCP-toggle unit: mirrors core's `settingsSchema.mcpAccess`
    // (a scalar boolean, default true) — gates the HTTP MCP listener
    // per-request server-side (`packages/app/src/mcp-http.ts`).
    mcpAccess: z.boolean().optional(),
    // Plan 026: per-source objects (master `enabled` + the render features that
    // source supports). Mirrors `core`'s `settingsSchema.plugins` exactly. The
    // edge validates the CURRENT (new) shape strictly — well-formed writes only;
    // legacy-boolean *reads* of pre-026 stored blobs are handled by core's
    // migration normalizer, not here.
    plugins: z
      .object({
        hacker_news: z
          .object({ enabled: z.boolean(), inline: z.boolean(), hover: z.boolean() })
          .strict(),
        github: z.object({ enabled: z.boolean(), hover: z.boolean() }).strict(),
        youtube: z.object({ enabled: z.boolean(), hover: z.boolean() }).strict(),
        twitter: z
          .object({ enabled: z.boolean(), inline: z.boolean(), hover: z.boolean() })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Registers the settings routes (plan 016): `GET /api/settings` (the full
 * map, every allowlisted key — unset keys fall back to their default, see
 * `core.getAllSettings`'s doc comment) and `PATCH /api/settings` (partial
 * update, Zod-validated at the edge AND re-validated per-key by
 * `core.updateSettings`). Unlocks the Settings modal's theme picker, the
 * 7/30/90 trash-purge-cycle picker, and the plugin on/off toggles — all
 * previously read-only/non-functional (see `PreferencesTab`/`PluginsTab`'s
 * pre-slice doc comments).
 *
 * Both routes return the SAME shape (`core.SettingsMap` directly — no
 * whitelist shaping needed the way `link-json.ts` shapes a `LinkWithTags`:
 * `SettingsMap` has no internal-only fields to leak, it's already exactly
 * the allowlisted map). An invalid PATCH body throws a Zod `ZodError`
 * (edge) or a plain `Error` (from `core.updateSettings`'s unknown-key/
 * invalid-value guard) — both are mapped by `app.ts`'s `onError` to
 * `400 validation_error` (a `ZodError`) or `500` (a plain `Error` — see the
 * note below on why the edge schema is the primary defense).
 */
export function registerSettingsRoutes(app: Hono): void {
  app.get('/settings', async (c) => {
    const settings = await getAllSettings();
    return c.json(settings);
  });

  app.patch('/settings', async (c) => {
    const body = settingsPatchBodySchema.parse(await c.req.json().catch(() => ({})));
    const settings = await updateSettings(body);
    return c.json(settings);
  });
}
