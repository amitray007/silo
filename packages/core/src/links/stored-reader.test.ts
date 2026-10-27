import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
const reader = { contentHtml: '<p>New body</p>', contentImages: ['https://cdn.test/new.png'] };

describeIfPg('stored Reader (Postgres)', () => {
  const harness = setupPgHarness('silo_stored_reader_test', async () => ({
    core: await import('../index.js'),
    database: await import('@silo/db'),
  }));
  afterEach(() => harness.mod().core.setReaderRefresher(undefined));
  async function saved(slug = 'one', sourceKind = 'link') {
    return harness.mod().core.createLink({
      url: `https://example.org/${slug}`,
      sourceKind,
      title: 'My title',
      tags: ['mine'],
    });
  }
  async function raw(id: string) {
    const {
      database: { db, links },
    } = harness.mod();
    return (await db.select().from(links).where(eq(links.id, id)))[0];
  }
  it('writes HTML, images, current version, timestamp and nonempty search text together', async () => {
    const { core } = harness.mod();
    const link = await saved();
    const written = await core.recordReader(
      link.id,
      {
        status: 'reader',
        reader,
        text: 'Searchable needle',
      },
      new Date(),
    );
    expect(written).toMatchObject(reader);
    expect(written?.capturedAt).toEqual(expect.any(String));
    expect(await raw(link.id)).toMatchObject({
      readerVersion: core.READER_VERSION,
      extractedText: 'Searchable needle',
    });
    expect((await core.search('needle')).results.map((r) => r.id)).toContain(link.id);
  });
  it('marks a successful empty extraction checked, clearing stale payload', async () => {
    const {
      core,
      database: { db, links },
    } = harness.mod();
    const link = await saved();
    await db
      .update(links)
      .set({ contentHtml: '<p>Legacy</p>', contentImages: ['https://old.test/a'] })
      .where(eq(links.id, link.id));
    await core.recordReader(link.id, { status: 'no_reader' }, new Date());
    expect(await raw(link.id)).toMatchObject({
      contentHtml: null,
      contentImages: null,
      readerVersion: core.READER_VERSION,
      readerCapturedAt: expect.any(Date),
    });
    expect(await core.getStoredReader(link.id)).toBeUndefined();
  });
  it('does not write anything after a fetch failure', async () => {
    const { core } = harness.mod();
    const link = await saved();
    await core.recordReader(link.id, { status: 'reader', reader }, new Date());
    const before = await raw(link.id);
    await core.recordReader(link.id, { status: 'fetch_failed' }, new Date());
    expect(await raw(link.id)).toEqual(before);
  });
  it('keeps a current Reader and its timestamp on a later empty extraction', async () => {
    const { core } = harness.mod();
    const link = await saved();
    await core.recordReader(
      link.id,
      { status: 'reader', reader, text: 'Original body' },
      new Date(),
    );
    const before = await raw(link.id);
    await core.recordReader(link.id, { status: 'no_reader' }, new Date());
    expect(await raw(link.id)).toEqual(before);
  });
  it('does not write a trashed link or Twitter', async () => {
    const { core } = harness.mod();
    for (const link of [await saved('trash'), await saved('tweet', 'twitter')]) {
      if (link.sourceKind !== 'twitter') await core.softDelete(link.id);
      const before = await raw(link.id);
      await core.recordReader(link.id, { status: 'reader', reader }, new Date());
      expect(await raw(link.id)).toEqual(before);
    }
  });
  it('treats payload from an older pipeline as stale', async () => {
    const {
      core,
      database: { db, links },
    } = harness.mod();
    const link = await saved();
    await core.recordReader(link.id, { status: 'reader', reader }, new Date());
    await db
      .update(links)
      .set({ readerVersion: core.READER_VERSION - 1 })
      .where(eq(links.id, link.id));
    expect(await core.getStoredReader(link.id)).toBeUndefined();
  });
  it('refresh preserves metadata and tags while updating Reader and search text', async () => {
    const { core } = harness.mod();
    const link = await saved();
    const before = await core.getById(link.id);
    core.setReaderRefresher(async () => ({ status: 'reader', reader, text: 'Replacement text' }));
    expect((await core.refreshReader(link.id)).status).toBe('reader');
    const after = await core.getById(link.id);
    expect(after).toMatchObject({
      title: before?.title,
      tags: ['mine'],
      description: before?.description,
      imageUrl: before?.imageUrl,
      siteName: before?.siteName,
      updatedAt: before?.updatedAt,
      extractedText: 'Replacement text',
    });
    expect(after).not.toHaveProperty('contentHtml');
    expect(after).not.toHaveProperty('contentImages');
  });
  it('times out at 45 seconds, aborts extraction and never writes a late result', async () => {
    const { core } = harness.mod();
    const link = await saved('deadline');
    let finish: ((result: import('../index.js').ReaderExtraction) => void) | undefined;
    let signal: AbortSignal | undefined;
    core.setReaderRefresher(async (_link, incoming) => {
      signal = incoming;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    vi.useFakeTimers();
    const work = core.refreshReader(link.id);
    try {
      await vi.waitFor(() => expect(signal).toBeDefined());
      await vi.advanceTimersByTimeAsync(45_000);
      expect(await work).toEqual({ status: 'fetch_failed' });
      expect(signal?.aborted).toBe(true);
      finish?.({ status: 'reader', reader });
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
    expect(await core.getStoredReader(link.id)).toBeUndefined();
    expect(await raw(link.id)).toMatchObject({ readerVersion: null, readerCapturedAt: null });
  });
  it('keeps matching Reader search text when a later metadata enrichment misses', async () => {
    const { core } = harness.mod();
    const link = await saved('metadata-miss');
    await core.recordReader(
      link.id,
      { status: 'reader', reader, text: 'Current reader text' },
      new Date(),
    );
    await core.recordReader(
      link.id,
      { status: 'no_reader', text: 'Transient empty page' },
      new Date(),
    );
    await core.recordEnrichment(link.id, { status: 'partial', text: 'Transient empty page' });
    expect((await core.getById(link.id))?.extractedText).toBe('Current reader text');
  });
  it('syncs nonempty fallback text when a successful check has no Reader', async () => {
    const { core } = harness.mod();
    const link = await saved('fallback-text');
    core.setReaderRefresher(async () => ({ status: 'no_reader', text: 'New fallback text' }));
    expect(await core.refreshReader(link.id)).toEqual({ status: 'no_reader' });
    expect((await core.getById(link.id))?.extractedText).toBe('New fallback text');
  });

  it('selects only eligible backfill rows, nulls first then oldest, at most 20', async () => {
    const {
      core,
      database: { db, links },
    } = harness.mod();
    const eligible = [];
    for (let i = 0; i < 22; i++) {
      const link = await saved(`eligible-${i}`);
      await db
        .update(links)
        .set({
          captureStatus: 'full',
          readerCapturedAt: new Date(2020, 0, i + 1),
          readerVersion: 0,
        })
        .where(eq(links.id, link.id));
      eligible.push(link);
    }
    const first = eligible[21];
    if (!first) throw new Error('Missing fixture');
    await db.update(links).set({ readerCapturedAt: null }).where(eq(links.id, first.id));
    await saved('enriching');
    const twitter = await saved('twitter', 'twitter');
    await core.recordEnrichment(twitter.id, { status: 'full' });
    const trash = await saved('trash');
    await core.recordEnrichment(trash.id, { status: 'full' });
    await core.softDelete(trash.id);
    const current = await saved('current');
    await core.recordEnrichment(current.id, { status: 'full' });
    await core.recordReader(current.id, { status: 'no_reader' }, new Date());
    const run = vi.fn(async (_link: { id: string }) => ({
      status: 'reader' as const,
      reader,
      text: 'Backfilled text',
    }));
    core.setReaderRefresher(run);
    expect(await core.runReaderBackfill()).toEqual({ found: 20, refreshed: 20 });
    expect(run.mock.calls).toHaveLength(20);
    expect(run.mock.calls.map(([link]) => link.id)).toEqual([
      first.id,
      ...eligible.slice(0, 19).map((r) => r.id),
    ]);
    expect(await core.getById(first.id)).toMatchObject({
      title: 'My title',
      tags: ['mine'],
      extractedText: 'Backfilled text',
    });
  });
  it('moves failed backfill behind older work without changing its stale version or Reader', async () => {
    const {
      core,
      database: { db, links },
    } = harness.mod();
    const failed = await saved('failed');
    const other = await saved('other');
    for (const link of [failed, other]) await core.recordEnrichment(link.id, { status: 'full' });
    await db
      .update(links)
      .set({ readerCapturedAt: new Date(2020, 0, 1), contentHtml: reader.contentHtml })
      .where(eq(links.id, failed.id));
    await db
      .update(links)
      .set({ readerCapturedAt: new Date(2020, 0, 2) })
      .where(eq(links.id, other.id));
    const order: string[] = [];
    core.setReaderRefresher(async (link) => {
      order.push(link.id);
      return { status: 'fetch_failed' };
    });
    await core.runReaderBackfill();
    expect(order).toEqual([failed.id, other.id]);
    expect(await raw(failed.id)).toMatchObject({
      readerVersion: null,
      contentHtml: reader.contentHtml,
    });
    await db
      .update(links)
      .set({ readerCapturedAt: new Date(2020, 0, 2) })
      .where(eq(links.id, other.id));
    order.length = 0;
    await core.runReaderBackfill();
    expect(order).toEqual([other.id]);
    await db
      .update(links)
      .set({ readerCapturedAt: new Date(Date.now() - 6 * 60 * 60 * 1000 - 1000) })
      .where(eq(links.id, failed.id));
    order.length = 0;
    await core.runReaderBackfill();
    expect(order).toEqual([failed.id]);
  });
  it.each(['reader', 'no_reader', 'text'] as const)(
    'rejects older %s state and text atomically',
    async (branch) => {
      const {
        core,
        database: { db, links },
      } = harness.mod();
      const link = await saved(`ordering-${branch}`);
      const newer = new Date('2026-01-02T00:00:00Z');
      const older = new Date('2026-01-01T00:00:00Z');
      await core.recordReader(link.id, { status: 'reader', reader, text: 'Winning text' }, newer);
      // A stale-version/null-HTML row makes the no_reader branch otherwise writable.
      if (branch !== 'reader')
        await db
          .update(links)
          .set({ readerVersion: 0, contentHtml: null })
          .where(eq(links.id, link.id));
      const before = await raw(link.id);
      await core.recordReader(
        link.id,
        branch === 'reader'
          ? {
              status: 'reader',
              reader: { contentHtml: '<p>Older</p>', contentImages: [] },
              text: 'Losing text',
            }
          : { status: 'no_reader', ...(branch === 'text' ? { text: 'Losing text' } : {}) },
        older,
      );
      expect(await raw(link.id)).toEqual(before);
    },
  );
  it.each(['reader', 'no_reader'] as const)(
    'returns a newer stored Reader when an older refresh yields %s',
    async (status) => {
      const { core } = harness.mod();
      const link = await saved(`late-${status}`);
      core.setReaderRefresher(async () => {
        await core.recordReader(
          link.id,
          { status: 'reader', reader, text: 'Winner' },
          new Date(Date.now() + 1000),
        );
        return status === 'reader'
          ? { status, reader: { contentHtml: '<p>Loser</p>', contentImages: [] } }
          : { status };
      });
      expect(await core.refreshReader(link.id)).toMatchObject({ status: 'reader', reader });
      expect((await raw(link.id))?.extractedText).toBe('Winner');
    },
  );
  it('rejects invalid Reader payload without throwing or changing state', async () => {
    const { core } = harness.mod();
    const link = await saved('invalid');
    await core.recordReader(link.id, { status: 'reader', reader }, new Date());
    const before = await raw(link.id);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        core.recordReader(
          link.id,
          {
            status: 'reader',
            reader: { ...reader, contentImages: ['javascript:alert(1)'] },
            text: 'Bad text',
          },
          new Date(),
        ),
      ).resolves.toBeNull();
      expect(log).toHaveBeenCalledWith(expect.any(String), link.id, expect.anything());
      expect(await raw(link.id)).toEqual(before);
    } finally {
      log.mockRestore();
    }
  });
  it('does not return a stored Reader on a trashed link', async () => {
    const { core } = harness.mod();
    const link = await saved('stored-trash');
    await core.recordReader(link.id, { status: 'reader', reader }, new Date());
    expect(await core.getStoredReader(link.id)).toBeDefined();
    await core.softDelete(link.id);
    expect(await core.getStoredReader(link.id)).toBeUndefined();
  });
  it.each(['', '  \n  '])('keeps existing text for empty input %j', async (text) => {
    const { core } = harness.mod();
    const link = await saved('empty-text');
    await core.recordReader(link.id, { status: 'reader', reader, text: 'Keep me' }, new Date());
    await core.recordReader(link.id, { status: 'reader', reader, text }, new Date());
    expect((await raw(link.id))?.extractedText).toBe('Keep me');
  });
  it('truncates search text without splitting a surrogate pair', async () => {
    const { core } = harness.mod();
    const link = await saved('surrogate');
    const prefix = 'x'.repeat(4_999_999);
    await core.recordReader(
      link.id,
      { status: 'reader', reader, text: `${prefix}😀tail` },
      new Date(),
    );
    expect((await raw(link.id))?.extractedText).toBe(prefix);
  });
  it.each(['throws', 'oversized'] as const)(
    'keeps stored state when refresher %s',
    async (failure) => {
      const { core } = harness.mod();
      const link = await saved(failure);
      await core.recordReader(link.id, { status: 'reader', reader }, new Date());
      const before = await raw(link.id);
      core.setReaderRefresher(async () => {
        if (failure === 'throws') throw new Error('broken refresher');
        return {
          status: 'reader',
          reader: { contentHtml: 'x'.repeat(1024 * 1024 + 1), contentImages: [] },
        };
      });
      expect(await core.refreshReader(link.id)).toEqual({ status: 'fetch_failed' });
      expect(await raw(link.id)).toEqual(before);
    },
  );
  it.each(['reader', 'failure-stamp'] as const)(
    'isolates one throwing %s write among three links',
    async (branch) => {
      const {
        core,
        database: { db },
      } = harness.mod();
      const { sql } = await import('drizzle-orm');
      const candidates = [
        await saved('isolation-a'),
        await saved('isolation-b'),
        await saved('isolation-c'),
      ].sort((a, b) => a.id.localeCompare(b.id));
      for (const link of candidates) await core.recordEnrichment(link.id, { status: 'full' });
      const middle = candidates[1];
      if (!middle) throw new Error('Missing fixture');
      // Real Postgres constraint rejects both reader writes and failure stamps for one row.
      await db.execute(
        sql`update links set title = 'reject-reader-test' where id = ${middle.id}::uuid`,
      );
      await db.execute(
        sql`alter table links add constraint reader_test_reject check (title <> 'reject-reader-test' or reader_captured_at is null)`,
      );
      const run = vi.fn(async () =>
        branch === 'reader'
          ? { status: 'reader' as const, reader }
          : { status: 'fetch_failed' as const },
      );
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(await core.runReaderBackfill(run)).toEqual({
          found: 3,
          refreshed: branch === 'reader' ? 2 : 0,
        });
        expect(run).toHaveBeenCalledTimes(3);
        expect(log).toHaveBeenCalledWith(expect.any(String), middle.id, expect.anything());
        for (const link of [candidates[0], candidates[2]])
          expect((await raw(link?.id ?? ''))?.readerCapturedAt).toBeInstanceOf(Date);
      } finally {
        await db.execute(sql`alter table links drop constraint reader_test_reject`);
        log.mockRestore();
      }
    },
  );
  it('aborts the active fetch and stops without stamping or processing another link', async () => {
    const { core } = harness.mod();
    const candidates = [await saved('abort-a'), await saved('abort-b'), await saved('abort-c')];
    for (const link of candidates) await core.recordEnrichment(link.id, { status: 'full' });
    const controller = new AbortController();
    let active: AbortSignal | undefined;
    const run = vi.fn(async (_link, signal: AbortSignal) => {
      active = signal;
      controller.abort();
      return { status: 'fetch_failed' as const };
    });
    expect(await core.runReaderBackfill(run, controller.signal)).toEqual({
      found: 3,
      refreshed: 0,
    });
    expect(run).toHaveBeenCalledOnce();
    expect(active?.aborted).toBe(true);
    for (const link of candidates) expect((await raw(link.id))?.readerCapturedAt).toBeNull();
    expect(await core.runReaderBackfill(run, controller.signal)).toEqual({
      found: 0,
      refreshed: 0,
    });
    expect(run).toHaveBeenCalledOnce();
  });
});
