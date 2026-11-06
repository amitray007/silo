import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('browser snapshot Reader (Postgres)', () => {
  let drop: () => void;
  let core: typeof import('@silo/core');
  let worker: typeof import('./reader-from-page.js');
  beforeAll(async () => {
    const database = createDisposableDatabase('silo_browser_page');
    drop = database.drop;
    const pool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(pool), pool, '../db/drizzle');
    process.env.DATABASE_URL = database.url;
    core = await import('@silo/core');
    core.setPageEnqueuer(async () => {});
    worker = await import('./reader-from-page.js');
  });
  afterAll(async () => {
    await (await import('@silo/db')).pool.end();
    await (await import('../extract/reader-worker.js')).closeReaderPool();
    drop();
  });
  it('extracts a browser page, deletes the raw copy and retains it after automatic capture', async () => {
    const url = 'https://example.org/subscriber';
    const link = await core.createLink({ sourceKind: 'link', url, title: 'Owner title' });
    await core.recordReaderAccess(link.id, 'paywalled', new Date());
    const capturedAt = new Date();
    const text =
      'This subscriber article explains the research and the evidence in detail. '.repeat(30);
    await core.savePageSnapshot(link.id, {
      url,
      html: `<html><head><title>Page title</title></head><body><article><h1>Research</h1><p>${text}</p></article></body></html>`,
      capturedAt,
    });
    await worker.readerFromPage(link.id);
    const saved = await core.getById(link.id);
    expect(saved).toMatchObject({
      readerSource: 'extension',
      title: 'Owner title',
      readerAccess: 'paywalled',
      captureStatus: 'full',
    });
    expect((await core.getStoredReader(link.id))?.contentHtml).toContain('subscriber article');
    expect(await core.getPageSnapshot(link.id)).toBeUndefined();
    await core.recordReader(
      link.id,
      { status: 'reader', reader: { contentHtml: '<p>Thin</p>', contentImages: [] } },
      new Date(+capturedAt + 1000),
    );
    await core.recordEnrichment(link.id, { status: 'bare' });
    expect(await core.getById(link.id)).toMatchObject({
      readerSource: 'extension',
      captureStatus: 'full',
    });
  });
  it('cleans old raw copies and does not delete a newer upload on an older completion', async () => {
    const { db, pageSnapshots } = await import('@silo/db');
    const { eq } = await import('drizzle-orm');
    const link = await core.createLink({ sourceKind: 'link', url: 'https://example.org/old' });
    const at = new Date();
    await core.savePageSnapshot(link.id, { url: link.url, html: '<p>Raw</p>', capturedAt: at });
    await core.deletePageSnapshot(link.id, new Date(+at - 1));
    expect(await core.getPageSnapshot(link.id)).toBeDefined();
    await db
      .update(pageSnapshots)
      .set({ createdAt: new Date(Date.now() - 2 * 86400_000) })
      .where(eq(pageSnapshots.linkId, link.id));
    await core.cleanupPageSnapshots();
    expect(await core.getPageSnapshot(link.id)).toBeUndefined();
  });
  it('rejects challenges and no-Reader copies without losing the saved Reader', async () => {
    const url = 'https://example.org/challenge';
    const link = await core.createLink({ sourceKind: 'link', url });
    const reader = { contentHtml: '<p>Original</p>', contentImages: [] };
    await core.recordReader(link.id, { status: 'reader', reader }, new Date());
    for (const html of [
      '<html><title>Just a moment...</title><body><div id="cf-challenge-running">Checking your browser</div></body></html>',
      '<html><body></body></html>',
    ]) {
      await core.savePageSnapshot(link.id, { url, html, capturedAt: new Date() });
      await worker.readerFromPage(link.id);
      expect((await core.getStoredReader(link.id))?.contentHtml).toBe(reader.contentHtml);
      expect(await core.getPageSnapshot(link.id)).toBeUndefined();
    }
  });
});
