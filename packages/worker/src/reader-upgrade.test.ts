import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('./fetch/safe-fetch.js', () => ({ safeFetch: vi.fn() }));
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('Reader upgrade job (Postgres)', () => {
  let core: typeof import('@silo/core');
  let job: typeof import('./reader-upgrade.js');
  let fetcher: ReturnType<typeof vi.mocked<typeof import('./fetch/safe-fetch.js').safeFetch>>;
  let pool: Pool;
  let drop: () => void;
  beforeAll(async () => {
    const database = createDisposableDatabase('silo_worker_reader_test');
    drop = database.drop;
    const migratePool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');
    process.env.DATABASE_URL = database.url;
    core = await import('@silo/core');
    job = await import('./reader-upgrade.js');
    fetcher = vi.mocked((await import('./fetch/safe-fetch.js')).safeFetch);
    pool = new Pool({ connectionString: database.url });
  }, 60_000);
  afterEach(async () => {
    fetcher.mockReset();
    await pool.query('TRUNCATE link_tags, links, tags CASCADE');
  });
  afterAll(async () => {
    const { pool: corePool } = await import('@silo/db');
    await corePool.end();
    await pool.end();
    drop();
  });

  async function capture(status: 'full' | 'partial' | 'bare') {
    const created = await core.createLink({
      url: `https://journal.example.org/${status}`,
      sourceKind: 'link',
      title: 'Keep title',
      notes: 'Keep notes',
      tags: ['keep'],
    });
    await core.recordEnrichment(created.id, { status, text: 'Keep existing text' });
    return created.id;
  }

  it.each(['full', 'partial', 'bare'] as const)(
    'fills Reader content for %s and preserves every other field',
    async (status) => {
      const id = await capture(status);
      const before = await core.getById(id);
      fetcher.mockResolvedValue({
        ok: true,
        html: '<main><h2>New reader</h2><p>New article content.</p><img src="/image.png"></main>',
        contentType: 'text/html',
        finalUrl: 'https://journal.example.org/redirected/',
        status: 200,
      });
      expect(await job.upgradeReader(id)).toBe('upgraded');
      const after = await core.getById(id);
      expect(after?.contentHtml).toContain('New article content.');
      expect(after?.contentImages).toEqual(['https://journal.example.org/image.png']);
      expect(after).toEqual({
        ...before,
        contentHtml: after?.contentHtml,
        contentImages: after?.contentImages,
      });
      fetcher.mockClear();
      expect(await job.upgradeReader(id)).toBe('unchanged');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([null, ''])(
    'fills missing text (%s) even when Reader HTML already exists',
    async (text) => {
      const id = await capture('bare');
      const reader = { contentHtml: '<p>Already captured Reader</p>', contentImages: [] };
      await core.recordReaderUpgrade(id, reader);
      await pool.query('UPDATE links SET extracted_text = $1 WHERE id = $2', [text, id]);
      const before = await core.getById(id);
      fetcher.mockResolvedValue({
        ok: true,
        html: '<article><p>Recovered search text.</p><img src="/new.png"></article>',
        contentType: 'text/html',
        finalUrl: 'https://journal.example.org/bare',
        status: 200,
      });
      expect(await core.findReaderUpgradeCandidates()).toEqual([{ id, url: before?.url }]);
      expect(await job.upgradeReader(id)).toBe('upgraded');
      const after = await core.getById(id);
      expect(after).toEqual({
        ...before,
        extractedText: 'Recovered search text.',
        searchVector: after?.searchVector,
      });
      expect(after?.searchVector).toContain("'recov'");
      expect(await job.upgradeReader(id)).toBe('unchanged');
    },
  );

  it('fills missing text together with new Reader content without changing status', async () => {
    const id = await capture('partial');
    await pool.query("UPDATE links SET extracted_text = '' WHERE id = $1", [id]);
    const before = await core.getById(id);
    fetcher.mockResolvedValue({
      ok: true,
      html: '<p>New search text.</p>',
      contentType: 'text/html',
      finalUrl: 'https://journal.example.org/partial',
      status: 200,
    });
    expect(await job.upgradeReader(id)).toBe('upgraded');
    const after = await core.getById(id);
    expect(after).toEqual({
      ...before,
      extractedText: 'New search text.',
      searchVector: after?.searchVector,
      contentHtml: after?.contentHtml,
      contentImages: [],
    });
  });

  it.each(['not-found', 'timeout'] as const)(
    'never trashes or modifies data on %s',
    async (reason) => {
      const id = await capture('full');
      const before = await core.getById(id);
      fetcher.mockResolvedValue({ ok: false, reason });
      expect(await job.upgradeReader(id)).toBe('unavailable');
      expect(await core.getById(id)).toEqual(before);
    },
  );

  it('keeps data on a non-HTML result and ignores trashed links', async () => {
    const id = await capture('full');
    const before = await core.getById(id);
    fetcher.mockResolvedValue({
      ok: true,
      html: '%PDF',
      contentType: 'application/pdf',
      finalUrl: before?.url ?? '',
      status: 200,
    });
    expect(await job.upgradeReader(id)).toBe('unavailable');
    expect(await core.getById(id)).toEqual(before);
    await core.softDelete(id);
    fetcher.mockClear();
    expect(await job.upgradeReader(id)).toBe('unchanged');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('explicitly refreshes existing HTML after a sanitizer change while preserving text and status', async () => {
    const id = await capture('full');
    await core.recordReaderUpgrade(id, {
      contentHtml: '<p>Old HTML</p><img src="https://journal.example.org/old.jpg">',
      contentImages: ['https://journal.example.org/old.jpg'],
    });
    const before = await core.getById(id);
    fetcher.mockResolvedValue({
      ok: true,
      html: '<table><tr><td><p>Refreshed prose.</p><img src="/new.jpg"></td></tr></table>',
      contentType: 'text/html',
      finalUrl: before?.url ?? '',
      status: 200,
    });
    expect(await core.findReaderUpgradeCandidates(undefined, true)).toEqual([
      { id, url: before?.url },
    ]);
    expect(await job.runReaderUpgrade(undefined, { refreshHtml: true })).toEqual({
      upgraded: 1,
      unchanged: 0,
      unavailable: 0,
    });
    const after = await core.getById(id);
    expect(after?.contentHtml).toContain('<p>Refreshed prose.</p>');
    expect(after?.contentHtml).not.toContain('<table');
    expect(after?.contentImages).toEqual(['https://journal.example.org/new.jpg']);
    expect(after).toEqual({
      ...before,
      contentHtml: after?.contentHtml,
      contentImages: after?.contentImages,
    });
    fetcher.mockResolvedValue({ ok: false, reason: 'timeout' });
    expect(await job.upgradeReader(id, undefined, { refreshHtml: true })).toBe('unavailable');
    expect(await core.getById(id)).toEqual(after);
  });

  it('resumes by skipping successful rows and retries prior failures on the next run', async () => {
    await capture('full');
    const retryId = await capture('bare');
    fetcher.mockImplementation(async (url) =>
      url.endsWith('/bare')
        ? { ok: false, reason: 'not-found' }
        : {
            ok: true,
            html: '<article><p>Captured Reader</p></article>',
            contentType: 'text/html',
            finalUrl: url,
            status: 200,
          },
    );
    expect(await job.runReaderUpgrade()).toEqual({ upgraded: 1, unchanged: 0, unavailable: 1 });
    expect(await core.getById(retryId)).not.toBeNull();
    fetcher.mockClear();
    fetcher.mockResolvedValue({
      ok: true,
      html: '<p>Recovered Reader</p>',
      contentType: 'text/html',
      finalUrl: 'https://journal.example.org/bare',
      status: 200,
    });
    expect(await job.runReaderUpgrade()).toEqual({ upgraded: 1, unchanged: 0, unavailable: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await job.runReaderUpgrade()).toEqual({ upgraded: 0, unchanged: 0, unavailable: 0 });
  });

  it('counts a link whose fetch or extract throws as unavailable and keeps going', async () => {
    await capture('full');
    await capture('partial');
    await capture('bare');
    const order = await core.findReaderUpgradeCandidates();
    expect(order).toHaveLength(3);
    const poisoned = order[1]?.url;
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetcher.mockImplementation(async (url) => {
      if (url === poisoned) throw new Error('parser exploded');
      return {
        ok: true,
        html: '<article><p>Captured Reader</p></article>',
        contentType: 'text/html',
        finalUrl: url,
        status: 200,
      };
    });
    try {
      const seen: string[] = [];
      expect(await job.runReaderUpgrade((id) => seen.push(id))).toEqual({
        upgraded: 2,
        unchanged: 0,
        unavailable: 1,
      });
      expect(seen).toEqual(order.map((candidate) => candidate.id));
      const [first, , last] = order;
      expect((await core.getById(first?.id ?? ''))?.contentHtml).not.toBeNull();
      expect((await core.getById(last?.id ?? ''))?.contentHtml).not.toBeNull();
    } finally {
      log.mockRestore();
    }
  });
});
