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
});
