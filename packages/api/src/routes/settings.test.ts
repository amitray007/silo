import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { ErrorEnvelope } from '../app.js';
import { expectOk } from '../test-support/assertions.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `GET /api/settings` + `PATCH
 * /api/settings` (plan 016) — the Settings modal's persistence surface,
 * driven via Hono's `app.request(...)` against a real Postgres. ONE
 * `setupPgHarness` for the whole file (see `trash.test.ts`'s doc comment for
 * why: `@silo/db`'s pool is a module-load-time singleton the harness's
 * `afterAll` permanently closes). The fresh-database defaults test runs
 * first (Vitest runs `it`s within a file in declaration order) so it can
 * assert true "never written" defaults before any other test writes a
 * setting.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

type SettingsBody = {
  theme: 'light' | 'dark' | 'system';
  trashPurgeDays: 7 | 30 | 90;
  mcpAccess: boolean;
  linkPreviewImages: boolean;
  hoverPreview: boolean;
  ai: {
    enabled: boolean;
    provider: 'anthropic' | 'openai' | 'gateway' | null;
    model: string | null;
    features: Record<string, boolean>;
  };
  plugins: {
    hacker_news: { enabled: boolean; inline: boolean; hover: boolean; palette: boolean };
    github: { enabled: boolean; hover: boolean; palette: boolean };
    youtube: { enabled: boolean; hover: boolean; palette: boolean };
    twitter: { enabled: boolean; inline: boolean; hover: boolean; palette: boolean };
  };
};

/** PATCHes `body` as JSON to `/api/settings` on `app` — the shared shape every PATCH test in this file needs. */
async function patchSettings(app: Hono, body: unknown): Promise<Response> {
  return app.request('/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describeIfPg('GET/PATCH /api/settings (integration, plan 016)', () => {
  const harness = setupPgHarness('silo_api_settings_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });

  it('GET returns defaults in a fresh database (runs first)', async () => {
    const { app } = harness.mod();
    const body = await expectOk<SettingsBody>(app, '/api/settings');
    expect(body).toEqual({
      theme: 'system',
      trashPurgeDays: 30,
      mcpAccess: true,
      linkPreviewImages: true,
      hoverPreview: false,
      chatAnswers: 'streamed',
      librarianThinking: 'low',
      librarianSuggestions: true,
      reader: null,
      librarianActions: harness.mod().core.LIBRARIAN_ACTIONS_DEFAULTS,
      linkCleaning: harness.mod().core.LINK_CLEANING_DEFAULTS,
      ai: {
        enabled: false,
        features: {
          librarian: { enabled: false, model: null },
          'x-post-title': { enabled: false, model: null },
        },
      },
      plugins: {
        hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      },
    });
  });

  it('GET response is EXACTLY the shaped settings map — no internal-field leak (top-level AND nested plugins keys)', async () => {
    const { app } = harness.mod();
    const body = (await expectOk<Record<string, unknown>>(app, '/api/settings')) as Record<
      string,
      unknown
    >;
    // Top-level: exactly the allowlisted keys, nothing else (e.g. no
    // stray internal/db-row field like `updatedAt` could leak through).
    expect(Object.keys(body).sort()).toEqual([
      'ai',
      'chatAnswers',
      'hoverPreview',
      'librarianActions',
      'librarianSuggestions',
      'librarianThinking',
      'linkCleaning',
      'linkPreviewImages',
      'mcpAccess',
      'plugins',
      'reader',
      'theme',
      'trashPurgeDays',
    ]);
    // Nested `plugins`: exactly the four allowlisted plugin keys — a
    // shallow top-level-only check (the pre-fix version of this test) would
    // miss a leaked/extra key nested inside `plugins`.
    const plugins = body.plugins as Record<string, unknown>;
    expect(Object.keys(plugins).sort()).toEqual(['github', 'hacker_news', 'twitter', 'youtube']);
  });

  it.each([true, false])('PATCH hoverPreview %s persists and GET reflects it', async (value) => {
    const { app } = harness.mod();
    const response = await patchSettings(app, { hoverPreview: value });
    expect(response.status).toBe(200);
    expect(((await response.json()) as SettingsBody).hoverPreview).toBe(value);
    expect((await expectOk<SettingsBody>(app, '/api/settings')).hoverPreview).toBe(value);
  });

  it.each(['true', 1, null])('PATCH rejects non-boolean hoverPreview %j', async (value) => {
    const { app } = harness.mod();
    const response = await patchSettings(app, { hoverPreview: value });
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorEnvelope).error).toBe('validation_error');
  });

  it('PATCH theme persists and is reflected by a subsequent GET', async () => {
    const { app } = harness.mod();
    const patchRes = await patchSettings(app, { theme: 'dark' });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as SettingsBody;
    expect(patchBody.theme).toBe('dark');

    const getBody = await expectOk<SettingsBody>(app, '/api/settings');
    expect(getBody.theme).toBe('dark');
  });

  it('PATCH trashPurgeDays to 7 persists and GET reflects it', async () => {
    const { app } = harness.mod();
    const patchRes = await patchSettings(app, { trashPurgeDays: 7 });
    expect(patchRes.status).toBe(200);

    const getBody = await expectOk<SettingsBody>(app, '/api/settings');
    expect(getBody.trashPurgeDays).toBe(7);
  });

  it('PATCH a single plugin toggle persists the full plugins record', async () => {
    const { app } = harness.mod();
    const patchRes = await patchSettings(app, {
      plugins: {
        hacker_news: { enabled: false, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
      },
    });
    expect(patchRes.status).toBe(200);

    const getBody = await expectOk<SettingsBody>(app, '/api/settings');
    expect(getBody.plugins).toEqual({
      hacker_news: { enabled: false, inline: true, hover: true, palette: true },
      github: { enabled: true, hover: true, palette: true },
      youtube: { enabled: true, hover: true, palette: true },
      twitter: { enabled: true, inline: true, hover: true, palette: true },
    });
  });

  it('PATCH is a genuine partial update — other keys are untouched', async () => {
    const { app } = harness.mod();
    await patchSettings(app, { theme: 'light' });
    await patchSettings(app, { trashPurgeDays: 90 });

    const getBody = await expectOk<SettingsBody>(app, '/api/settings');
    expect(getBody.theme).toBe('light');
    expect(getBody.trashPurgeDays).toBe(90);
  });

  it('PATCH with an empty body is a valid no-op, returning the current full map', async () => {
    const { app } = harness.mod();
    await patchSettings(app, { theme: 'dark' });
    const res = await patchSettings(app, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as SettingsBody;
    expect(body.theme).toBe('dark');
  });

  it('PATCH rejects an invalid trashPurgeDays (5) with 400 validation_error', async () => {
    const { app } = harness.mod();
    const res = await patchSettings(app, { trashPurgeDays: 5 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('validation_error');
  });

  it('PATCH rejects an invalid theme value with 400 validation_error', async () => {
    const { app } = harness.mod();
    const res = await patchSettings(app, { theme: 'blue' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('validation_error');
  });

  it('PATCH rejects an unknown top-level key with 400 validation_error', async () => {
    const { app } = harness.mod();
    const res = await patchSettings(app, { notARealSetting: true });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('validation_error');
  });

  it('PATCH rejects an unknown top-level plugin key with 400 validation_error', async () => {
    // The plan-026 migration normalizer reshapes the three KNOWN source keys
    // but passes any unrecognized top-level key through unchanged, so the
    // schema's `.strict()` still rejects a stray plugin name.
    const { app } = harness.mod();
    const res = await patchSettings(app, {
      plugins: {
        hacker_news: { enabled: true, inline: true, hover: true, palette: true },
        github: { enabled: true, hover: true, palette: true },
        youtube: { enabled: true, hover: true, palette: true },
        twitter: { enabled: true, inline: true, hover: true, palette: true },
        evilPlugin: true,
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('validation_error');
  });

  it('PATCH rejects a legacy-boolean / incomplete plugins record at the edge with 400', async () => {
    // Writes must be well-formed in the CURRENT (per-source object) shape: the
    // edge schema strictly validates the new shape, so a legacy boolean value
    // (or a record missing a source key) 400s here. The plan-026 migration
    // that self-heals legacy blobs is READ-only (for pre-026 stored data);
    // it does not loosen the write contract. Our own web client always sends
    // the full new shape, so this only ever rejects genuinely malformed writes.
    const { app } = harness.mod();
    const res = await patchSettings(app, {
      plugins: { hacker_news: true, github: true },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error).toBe('validation_error');
  });

  it('an invalid PATCH does not partially apply — a rejected field is not silently merged elsewhere', async () => {
    const { app } = harness.mod();
    await patchSettings(app, { theme: 'light' });
    const res = await patchSettings(app, { theme: 'dark', trashPurgeDays: 5 });
    expect(res.status).toBe(400);

    const getBody = await expectOk<SettingsBody>(app, '/api/settings');
    // Neither field in the rejected request should have landed.
    expect(getBody.theme).toBe('light');
  });

  it('reader: starts unset, a partial patch keeps other fields, bad values and unknown fields are rejected', async () => {
    const { app } = harness.mod();
    expect((await expectOk<{ reader: unknown }>(app, '/api/settings')).reader).toBeNull();

    const first = await patchSettings(app, { reader: { type: { size: 20 } } });
    expect(first.status).toBe(200);
    const created = ((await first.json()) as { reader: Record<string, unknown> }).reader;
    // The first write fills every other field with its default.
    expect(created).toEqual({
      type: { font: 'inter', size: 20, leading: 'normal', theme: 'default' },
      width: 'medium',
      pencil: { style: 'underline', wpm: 240 },
      highlight: { color: 'yellow' },
      readAloud: {
        engine: 'phonon',
        pauses: 'relaxed',
        voices: { phonon: '', kokoro: '' },
        rate: 1,
      },
    });

    // A second patch changes its own fields only, including one nested voice.
    const second = await patchSettings(app, {
      reader: {
        readAloud: { voices: { kokoro: 'af_heart' }, rate: 1.5, pauses: 'natural' },
        width: 'wide',
      },
    });
    const merged = ((await second.json()) as { reader: Record<string, unknown> }).reader;
    expect(merged).toMatchObject({
      type: { size: 20 },
      width: 'wide',
      readAloud: {
        engine: 'phonon',
        pauses: 'natural',
        voices: { phonon: '', kokoro: 'af_heart' },
        rate: 1.5,
      },
    });

    for (const bad of [
      { type: { size: 13 } },
      { type: { size: 16.5 } },
      { type: { font: 'comic' } },
      { pencil: { wpm: 90 } },
      { pencil: { wpm: 250 } },
      { highlight: { color: 'red' } },
      { readAloud: { rate: 4 } },
      { readAloud: { pauses: 'fast' } },
      { readAloud: { voices: { phonon: 'x'.repeat(65) } } },
      { readAloud: { voices: { piper: 'x' } } },
      { colour: 'blue' },
      { type: { weight: 'bold' } },
    ]) {
      const res = await patchSettings(app, { reader: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    // Nothing from the rejected requests landed.
    expect(
      (await expectOk<{ reader: Record<string, unknown> }>(app, '/api/settings')).reader,
    ).toEqual(merged);
  });

  it.each(['界', '\u0001'])(
    'PATCH accepts the largest action lists with %j prompts',
    async (character) => {
      const { app, core } = harness.mod();
      const actions = structuredClone(core.LIBRARIAN_ACTIONS_DEFAULTS);
      for (const list of ['passage', 'article', 'library'] as const) {
        for (const entry of actions[list]) {
          if ('hidden' in entry) entry.hidden = true;
        }
        for (let i = 0; i < 6; i++) {
          actions[list].push({
            id: `custom:00000000-0000-4000-8000-00000000000${i}`,
            label: character.repeat(24),
            prompt: character.repeat(1000),
          });
        }
      }
      const size = Buffer.byteLength(JSON.stringify({ librarianActions: actions }));
      expect(size).toBeLessThan(128 * 1024);
      if (character === '\u0001') expect(size).toBeGreaterThan(96 * 1024);
      const response = await patchSettings(app, { librarianActions: actions });
      expect(response.status).toBe(200);
      expect((await core.getAllSettings()).librarianActions).toEqual(actions);
    },
  );

  it('PATCH still rejects far larger action bodies and keeps the small limit for other keys', async () => {
    const { app } = harness.mod();
    for (const body of [
      { librarianActions: { prompt: 'x'.repeat(128 * 1024) } },
      { theme: 'dark', padding: 'x'.repeat(17 * 1024) },
    ]) {
      const response = await patchSettings(app, body);
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: 'payload_too_large' });
    }
  });

  it('drift guard: every key in core.SETTINGS_DEFAULTS is accepted by the edge PATCH schema (200, not 400)', async () => {
    // The edge schema (settingsPatchBodySchema in routes/settings.ts) is
    // hand-duplicated from core's allowlist (schema.ts's settingsSchema),
    // NOT derived from it (see that route's doc comment for why — core's
    // schema is a per-key map, not a single request-body shape). A review
    // flagged the drift risk this creates: if core's allowlist ever gains a
    // key (or narrows a value) without the edge schema being updated in
    // lockstep, a request valid against core would 500 (an uncaught plain
    // Error, not a ZodError) instead of 400 at the edge. This test doesn't
    // eliminate that risk (it can't, without exporting core's raw Zod
    // schema), but it DOES lock in that every currently-known default key
    // round-trips through the edge as a 200 today — a future key added to
    // `SETTINGS_DEFAULTS` without a matching edge-schema update will make
    // this test fail (PATCH-ing the unknown key back to itself 400s at the
    // edge as "unknown key"), catching the drift here instead of only in
    // production.
    const { core, app } = harness.mod();
    for (const [key, value] of Object.entries(core.SETTINGS_DEFAULTS)) {
      // `reader` defaults to null (never saved), which is not a valid write; an empty patch is.
      const res = await patchSettings(app, { [key]: value ?? {} });
      expect(res.status, `PATCH { ${key}: ... } should be accepted at the edge`).toBe(200);
    }
  });
});
