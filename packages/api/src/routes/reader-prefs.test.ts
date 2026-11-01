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
});
