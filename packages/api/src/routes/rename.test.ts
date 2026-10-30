import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const h = setupPgHarness('silo_api_rename', async () => ({
  core: await import('@silo/core'),
  app: (await import('../app.js')).createApp(),
}));
const patch = (body: unknown) => ({
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
it('sets, trims and clears a feed title, with typed invalid and missing responses', async () => {
  const { app, core } = h.mod();
  core.setFeedResolver(async () => ({
    feedUrl: 'https://example.com/rename',
    siteUrl: 'https://example.com',
    title: 'Fetched',
    format: 'rss',
    entries: [],
    intervalSeconds: 3600,
  }));
  const result = await core.subscribeFeed({
    url: 'https://example.com/rename',
    syncRecents: false,
  });
  if ('error' in result) throw new Error(result.error);
  const path = `/api/feeds/${result.feed.id}`;
  expect(await (await app.request(path, patch({ title: '  Mine  ' }))).json()).toMatchObject({
    feed: { title: 'Mine' },
  });
  expect(await (await app.request(path, patch({ title: null }))).json()).toMatchObject({
    feed: { title: 'Fetched' },
  });
  for (const title of ['', ' ', 'x'.repeat(201), 42]) {
    const response = await app.request(path, patch({ title }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'validation_error' });
  }
  expect(
    (await app.request(`/api/feeds/${randomUUID()}`, patch({ title: 'Missing' }))).status,
  ).toBe(404);
  core.setFeedResolver(undefined);
});
it('renames tags, requires confirmation before merging, and keeps tags on links', async () => {
  const { app, core } = h.mod();
  const link = await core.createLink({
    url: 'https://example.com/tag-rename-api',
    sourceKind: 'link',
    tags: ['Old'],
  });
  expect(await (await app.request('/api/tags/old', patch({ name: '  Renamed  ' }))).json()).toEqual(
    { name: 'Renamed', merged: false },
  );
  await core.createTag('Target');
  const conflict = await app.request('/api/tags/Renamed', patch({ name: 'target' }));
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ error: 'tag_exists', details: { name: 'Target' } });
  expect((await core.getById(link.id))?.tags).toEqual(['Renamed']);
  expect(
    await (await app.request('/api/tags/Renamed', patch({ name: 'target', merge: true }))).json(),
  ).toEqual({ name: 'Target', merged: true });
  expect((await core.getById(link.id))?.tags).toEqual(['Target']);
  expect((await app.request('/api/tags/missing', patch({ name: 'Next' }))).status).toBe(404);
  expect((await app.request('/api/tags/Target', patch({ name: ' ' }))).status).toBe(400);
});
