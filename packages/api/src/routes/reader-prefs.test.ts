import type { ReaderPrefs } from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('article reader preferences routes', () => {
  const harness = setupPgHarness('silo_api_article_prefs_test', async () => {
    const { createApp } = await import('../app.js');
    return {
      app: createApp(),
      core: await import('@silo/core'),
      pool: (await import('@silo/db')).pool,
    };
  });
  let count = 0;
  const create = () =>
    harness.mod().core.createLink({ url: `https://example.com/a-${count++}`, sourceKind: 'link' });
  const patch = (id: string, body: unknown) =>
    harness.mod().app.request(`/api/links/${id}/reader-prefs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('returns partial overrides in detail, deep-merges voices, clears, and keeps summary payloads clean', async () => {
    const { app } = harness.mod();
    const link = await create();
    const detail = async () =>
      (await (await app.request(`/api/links/${link.id}`)).json()) as {
        link: Record<string, unknown>;
      };
    expect((await detail()).link.readerPrefs).toEqual({});
    expect((await patch(link.id, { readAloud: { voices: { phonon: 'amy' } } })).status).toBe(200);
    const response = await patch(link.id, {
      readAloud: { voices: { kokoro: 'af_heart' } },
      type: { size: 20 },
    });
    expect(await response.json()).toEqual({
      readerPrefs: {
        readAloud: { voices: { phonon: 'amy', kokoro: 'af_heart' } },
        type: { size: 20 },
      },
    });
    const row = (await detail()).link;
    expect(row.readerPrefs).toEqual({
      readAloud: { voices: { phonon: 'amy', kokoro: 'af_heart' } },
      type: { size: 20 },
    });
    for (const key of ['prefs', 'canonicalUrl', 'searchVector', 'deletedAt', 'readerHtml'])
      expect(row).not.toHaveProperty(key);
    const list = (await (await app.request('/api/links')).json()) as {
      links: Record<string, unknown>[];
    };
    expect(list.links).toHaveLength(1);
    expect(list.links[0]).not.toHaveProperty('readerPrefs');
    expect(
      (await app.request(`/api/links/${link.id}/reader-prefs`, { method: 'DELETE' })).status,
    ).toBe(204);
    expect((await detail()).link.readerPrefs).toEqual({});
    expect(
      (await app.request(`/api/links/${link.id}/reader-prefs`, { method: 'DELETE' })).status,
    ).toBe(204);
  });

  it.each([
    { type: { size: 13 } },
    { pencil: { wpm: 101 } },
    { width: 'huge' },
    { readAloud: { rate: 9 } },
    { readAloud: { voices: { extra: 'x' } } },
    { unknown: true },
    { type: { unknown: true } },
  ])('uses the standard validation envelope for %j', async (body) => {
    const link = await create();
    const res = await patch(link.id, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'validation_error',
      message: expect.any(String),
    });
  });

  it('rejects malformed JSON with the validation envelope', async () => {
    const link = await create();
    const res = await harness.mod().app.request(`/api/links/${link.id}/reader-prefs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'validation_error' });
  });

  it('rejects malformed ids, missing and trashed links, and feed writes', async () => {
    const { core, app } = harness.mod();
    expect((await patch('bad-id', {})).status).toBe(400);
    expect((await patch('11111111-1111-4111-8111-111111111111', {})).status).toBe(404);
    const link = await create();
    await core.softDelete(link.id);
    expect((await patch(link.id, {})).status).toBe(404);
    expect(
      (await app.request(`/api/links/${link.id}/reader-prefs`, { method: 'DELETE' })).status,
    ).toBe(404);
    await harness
      .mod()
      .pool.query(
        "insert into feeds (id, feed_url, title, format, next_poll_at) values ('11111111-1111-4111-8111-111111111111', 'https://example.com/feed', 'Feed', 'rss', now())",
      );
    await harness
      .mod()
      .pool.query(
        "update links set deleted_at = null, feed_id = '11111111-1111-4111-8111-111111111111' where id = $1",
        [link.id],
      );
    for (const response of [
      await patch(link.id, { width: 'wide' }),
      await app.request(`/api/links/${link.id}/reader-prefs`, { method: 'DELETE' }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'feed_post_not_editable' });
    }
  });

  it.each(['article', 'defaults'] as const)(
    'keeps the newer %s snapshot when an older in-flight request arrives last',
    async (scope) => {
      const { app, core } = harness.mod();
      const link = await create();
      const path = scope === 'article' ? `/api/links/${link.id}/reader-prefs` : '/api/settings';
      const base: ReaderPrefs | null =
        scope === 'defaults'
          ? (
              await core.updateSettings(
                { reader: { type: { size: 16 } } },
                new Date(Date.now() - 3000),
              )
            ).reader
          : {};
      const earlier = { ...base, type: { ...base?.type, size: 20 } };
      const latest = { ...earlier, width: 'wide' };
      const olderTime = new Date(Date.now() - 2000).toISOString();
      const newerTime = new Date(Date.now() - 1000).toISOString();
      const body = (value: unknown, writtenAt?: string) => ({
        ...(scope === 'article' ? (value as object) : { reader: value }),
        ...(writtenAt ? { writtenAt } : {}),
      });
      // The older HTTP request is already in flight, but its body finishes after pagehide's write.
      let finishBody = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          finishBody = () => {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(body(earlier, olderTime))));
            controller.close();
          };
        },
      });
      const pending = app.request(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: stream,
        ...{ duplex: 'half' },
      });
      const keepalive = await app.request(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body(latest, newerTime)),
        // Fetch keepalive is a browser option; the received server Request does not carry it.
      });
      expect(keepalive.status, await keepalive.clone().text()).toBe(200);
      finishBody();
      const late = await pending;
      expect(late.status).toBe(200);
      const response = (await late.json()) as { readerPrefs?: unknown; reader?: unknown };
      expect(scope === 'article' ? response.readerPrefs : response.reader).toEqual(latest);
      const stored =
        scope === 'article'
          ? (await core.getById(link.id))?.readerPrefs
          : (await core.getAllSettings()).reader;
      expect(stored).toEqual(latest);
      // Old clients without timestamps still deep-merge, with last-write-wins behavior.
      const legacy = await app.request(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body({ type: { size: 18 } })),
      });
      expect(legacy.status).toBe(200);
      expect(await legacy.json()).toMatchObject(
        scope === 'article'
          ? { readerPrefs: { type: { size: 18 }, width: 'wide' } }
          : { reader: { type: { size: 18 }, width: 'wide' } },
      );
    },
  );

  it.each(['article', 'defaults'] as const)(
    'clamps future %s timestamps to the server clock',
    async (scope) => {
      const { core, pool } = harness.mod();
      const link = await create();
      const future = new Date(Date.now() + 86_400_000);
      if (scope === 'article') await core.patchReaderPrefs(link.id, { width: 'wide' }, future);
      else await core.updateSettings({ reader: { width: 'wide' } }, future);
      const result =
        scope === 'article'
          ? await pool.query(
              'select updated_at <= now() as clamped from link_reader_prefs where link_id = $1',
              [link.id],
            )
          : await pool.query(
              "select updated_at <= now() as clamped from settings where key = 'reader'",
            );
      expect(result.rows[0]).toEqual({ clamped: true });
      // Move beyond JavaScript's millisecond precision after Postgres's finer clock stamp.
      await pool.query('select pg_sleep(0.002)');
      // A subsequent normal-clock request is accepted, rather than blocked for a day.
      if (scope === 'article') {
        expect(await core.patchReaderPrefs(link.id, { width: 'narrow' }, new Date())).toMatchObject(
          { width: 'narrow' },
        );
      } else {
        expect(
          await core.updateSettings({ reader: { width: 'narrow' } }, new Date()),
        ).toMatchObject({ reader: { width: 'narrow' } });
      }
    },
  );

  it.each([false, true])(
    'rejects oversized JSON before parsing (content length: %s)',
    async (withLength) => {
      const { app, core } = harness.mod();
      const link = await create();
      const defaults = (await core.getAllSettings()).reader;
      // Invalid JSON proves the size limit runs before the JSON/validation handler.
      const body = `{${'x'.repeat(16 * 1024)}`;
      for (const path of [`/api/links/${link.id}/reader-prefs`, '/api/settings']) {
        const res = await app.request(path, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(withLength ? { 'Content-Length': String(body.length) } : {}),
          },
          body,
        });
        expect(res.status).toBe(413);
        expect(await res.json()).toEqual({
          error: 'payload_too_large',
          message: expect.any(String),
        });
      }
      expect((await core.getById(link.id))?.readerPrefs).toEqual({});
      expect((await core.getAllSettings()).reader).toEqual(defaults);
    },
  );
});
