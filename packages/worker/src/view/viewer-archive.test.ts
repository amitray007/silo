import { afterEach, expect, it, vi } from 'vitest';
import type { SafeFetchResult } from '../fetch/safe-fetch.js';
import { createPageViewer } from './viewer.js';

const viewers: ReturnType<typeof createPageViewer>[] = [];
afterEach(async () => {
  await Promise.all(viewers.splice(0).map((viewer) => viewer.close()));
  vi.restoreAllMocks();
});
function setup(
  body = '{}',
  failure: SafeFetchResult = { ok: false, reason: 'http-error', status: 403 },
) {
  const archiveFetch = vi.fn(
    async (): Promise<SafeFetchResult> => ({
      ok: true,
      status: 200,
      finalUrl: 'https://archive.org/',
      contentType: 'application/json',
      html: body,
    }),
  );
  const viewer = createPageViewer({ fetch: async () => failure, archiveFetch });
  viewers.push(viewer);
  const request = (archiveSnapshotAt?: Date, id = 'a') =>
    viewer.view({
      id,
      url: 'https://publisher.test/article',
      origin: 'https://silo.test',
      signal: new AbortController().signal,
      ...(archiveSnapshotAt ? { archiveSnapshotAt } : {}),
    });
  return { request, archiveFetch };
}
const hit = JSON.stringify({
  archived_snapshots: {
    closest: {
      available: true,
      timestamp: '20261016010203',
      url: 'https://evil.test/',
    },
  },
});
const expected = {
  mode: 'archive',
  archiveUrl: 'https://web.archive.org/web/20261016010203if_/https://publisher.test/article',
  snapshotAt: '2026-10-16T01:02:03.000Z',
};
it('uses the stored archive snapshot without a request', async () => {
  const { request, archiveFetch } = setup();
  expect((await request(new Date(expected.snapshotAt))).frame).toEqual(expected);
  expect(archiveFetch).not.toHaveBeenCalled();
});
it('uses only the availability timestamp and caches the hit for one hour', async () => {
  const { request, archiveFetch } = setup(hit);
  expect((await request()).frame).toEqual(expected);
  expect((await request()).frame).toEqual(expected);
  expect(archiveFetch).toHaveBeenCalledTimes(1);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_001);
  expect((await request()).frame).toEqual(expected);
  expect(archiveFetch).toHaveBeenCalledTimes(2);
});
it.each([
  '{}',
  'null',
  'not json',
  JSON.stringify({
    archived_snapshots: { closest: { available: true, timestamp: '20260230010203' } },
  }),
])('caches an unavailable or malformed result: %s', async (body) => {
  const { request, archiveFetch } = setup(body);
  expect((await request()).frame).toEqual({ mode: 'none', reason: 'blocked' });
  await request();
  expect(archiveFetch).toHaveBeenCalledTimes(1);
});
it('does not look up archives for non-blocked failures', async () => {
  const { request, archiveFetch } = setup(hit, { ok: false, reason: 'not-found', status: 404 });
  expect((await request()).frame).toEqual({ mode: 'none', reason: 'not-found' });
  expect(archiveFetch).not.toHaveBeenCalled();
});
