import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EnrichLinkDeps } from './enrich.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('targeted enrichment worker (integration)', () => {
  let dropDatabase: () => void;
  let core: typeof import('@silo/core');
  let worker: typeof import('./enrich.js');
  let pool: Pool;

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_worker_enrich_fields_test');
    dropDatabase = database.drop;
    const migratePool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');
    process.env.DATABASE_URL = database.url;
    core = await import('@silo/core');
    worker = await import('./enrich.js');
    pool = new Pool({ connectionString: database.url });
  }, 60_000);

  afterAll(async () => {
    const { pool: corePool } = await import('@silo/db');
    await corePool.end();
    await pool.end();
    dropDatabase();
  }, 60_000);

  const post = {
    kind: 'twitter' as const,
    text: 'An author releases a new command menu.',
    authorName: 'Author',
    authorHandle: 'author',
    likes: 1,
    reposts: 2,
    replies: 3,
    quotes: 0,
    bookmarks: 0,
    threadAfter: [{ id: '123', text: 'It also supports keyboard navigation.' }],
  };

  function deps() {
    return {
      safeFetch: vi.fn<EnrichLinkDeps['safeFetch']>().mockResolvedValue({
        ok: true,
        html: '<p>Article body</p>',
        contentType: 'text/html',
        finalUrl: 'https://example.org/article',
        status: 200,
      }),
      extract: vi.fn<EnrichLinkDeps['extract']>().mockResolvedValue({
        title: 'New page title',
        description: 'New description',
        imageUrl: 'https://example.org/new.png',
        siteName: 'New site',
        text: 'New body. '.repeat(50),
        status: 'full',
      }),
      enrichSource: vi.fn<EnrichLinkDeps['enrichSource']>().mockResolvedValue(post),
      getPluginsSetting: vi
        .fn<EnrichLinkDeps['getPluginsSetting']>()
        .mockImplementation(() => Promise.resolve(core.SETTINGS_DEFAULTS.plugins)),
      selectReader: vi.fn<NonNullable<EnrichLinkDeps['selectReader']>>().mockResolvedValue({
        status: 'reader',
        reader: { contentHtml: '<p>New Reader</p>', contentImages: [] },
        text: 'New Reader body',
      }),
      runXPostTitle: vi
        .fn<NonNullable<EnrichLinkDeps['runXPostTitle']>>()
        .mockResolvedValue({ ok: true, value: 'Author releases a command menu' }),
    };
  }

  async function seed(name: string, twitter = false, stored = true) {
    const link = await core.createLink({
      url: twitter ? `https://x.com/author/status/${name}` : `https://example.org/${name}`,
      sourceKind: twitter ? 'twitter' : 'link',
    });
    await core.recordEnrichment(link.id, {
      status: 'partial',
      title: 'Original page title',
      description: 'Original description',
      ...(twitter && stored ? { sourceData: post } : {}),
    });
    return link.id;
  }

  it('X title uses stored text and thread without source, fetch, extraction or Reader work', async () => {
    const id = await seed('1001', true);
    await core.requestEnrich(id, { fields: ['title'] });
    const injected = deps();
    await worker.enrichLink(id, injected);
    expect(injected.enrichSource).not.toHaveBeenCalled();
    expect(injected.getPluginsSetting).not.toHaveBeenCalled();
    expect(injected.safeFetch).not.toHaveBeenCalled();
    expect(injected.extract).not.toHaveBeenCalled();
    expect(injected.selectReader).not.toHaveBeenCalled();
    expect(injected.runXPostTitle).toHaveBeenCalledWith(
      expect.objectContaining({ text: post.text, thread: [post.threadAfter[0]?.text] }),
      expect.any(AbortSignal),
    );
    expect(await core.getById(id)).toMatchObject({
      title: 'Author releases a command menu',
      titleSource: 'ai',
      captureStatus: 'partial',
      enrichFields: null,
      enrichFloorStatus: null,
      description: 'Original description',
      sourceData: post,
      extractedText: null,
      enrichAttempts: 1,
    });
  });

  it('records the started request and keeps the successor narrow with its original floor', async () => {
    const id = await seed('active-title', true);
    const started = await core.requestEnrich(id, { fields: ['title'] });
    const injected = deps();
    injected.runXPostTitle.mockImplementationOnce(async () => {
      await core.requestEnrich(id, { fields: ['source'] });
      return { ok: true, value: 'Updated title' };
    });
    await worker.enrichLink(id, injected);
    expect(await core.getById(id)).toMatchObject({
      title: 'Updated title',
      enrichRequestSeq: (started?.enrichRequestSeq ?? 0) + 1,
      enrichFields: ['title', 'source'],
      enrichFloorStatus: 'partial',
      captureStatus: 'enriching',
      enrichAttempts: 1,
    });
    await worker.enrichLink(id, injected);
    expect(injected.safeFetch).not.toHaveBeenCalled();
    expect(await core.getById(id)).toMatchObject({
      enrichFields: null,
      enrichFloorStatus: null,
      captureStatus: 'partial',
      enrichAttempts: 1,
    });
  });

  it('missing X text calls only the source API before AI and does not write source_data', async () => {
    const id = await seed('1002', true, false);
    await core.requestEnrich(id, { fields: ['title'] });
    const injected = deps();
    await worker.enrichLink(id, injected);
    expect(injected.enrichSource).toHaveBeenCalledOnce();
    expect(injected.safeFetch).not.toHaveBeenCalled();
    expect(injected.extract).not.toHaveBeenCalled();
    expect(injected.selectReader).not.toHaveBeenCalled();
    expect(injected.runXPostTitle).toHaveBeenCalledOnce();
    expect(await core.getById(id)).toMatchObject({
      titleSource: 'ai',
      sourceData: { kind: 'link' },
    });
  });

  it('X title with AI off writes no new content', async () => {
    const id = await seed('1003', true);
    await core.requestEnrich(id, { fields: ['title'] });
    const injected = deps();
    injected.runXPostTitle.mockResolvedValue({ ok: false, code: 'off' });
    await worker.enrichLink(id, injected);
    expect(await core.getById(id)).toMatchObject({
      title: 'Original page title',
      titleSource: 'page',
      captureStatus: 'partial',
      sourceData: post,
    });
  });

  it('a user title survives an edit while the AI call is in flight', async () => {
    const id = await seed('1004', true);
    await core.requestEnrich(id, { fields: ['title'] });
    const injected = deps();
    injected.runXPostTitle.mockImplementation(async () => {
      await core.editLink(id, { title: 'Owner title' });
      return { ok: true, value: 'Late AI title' };
    });
    await worker.enrichLink(id, injected);
    expect(await core.getById(id)).toMatchObject({ title: 'Owner title', titleSource: 'user' });
    await core.requestEnrich(id, { fields: ['title'] });
    injected.runXPostTitle.mockClear();
    await worker.enrichLink(id, injected);
    expect(injected.runXPostTitle).not.toHaveBeenCalled();
  });

  it('the row requests a new AI title even when dedup kept a capture payload', async () => {
    const id = await seed('1005', true);
    await core.recordEnrichment(id, {
      status: 'partial',
      title: 'Old AI title',
      titleSource: 'ai',
    });
    await core.requestEnrich(id, { fields: ['title'] });
    const injected = deps();
    await worker.enrichLink(id, injected, { trigger: 'capture', previousStatus: 'partial' });
    expect(injected.runXPostTitle).toHaveBeenCalledOnce();
    expect((await core.getById(id))?.title).toBe('Author releases a command menu');
  });

  it('metadata skips Reader work and preserves existing Reader and text', async () => {
    const id = await seed('metadata');
    await core.recordReader(
      id,
      {
        status: 'reader',
        reader: { contentHtml: '<p>Original Reader</p>', contentImages: [] },
        text: 'Original body',
      },
      new Date(),
    );
    await core.requestEnrich(id, { fields: ['metadata'] });
    const injected = deps();
    await worker.enrichLink(id, injected);
    expect(injected.extract).toHaveBeenCalledWith(expect.objectContaining({ reader: false }));
    expect(injected.selectReader).not.toHaveBeenCalled();
    expect(injected.enrichSource).not.toHaveBeenCalled();
    expect(injected.runXPostTitle).not.toHaveBeenCalled();
    expect(await core.getById(id)).toMatchObject({
      title: 'New page title',
      description: 'New description',
      extractedText: 'Original body',
      captureStatus: 'partial',
    });
    expect(await core.getStoredReader(id)).toMatchObject({ contentHtml: '<p>Original Reader</p>' });
  });

  it('X metadata comes from the source API without a page fetch or AI', async () => {
    const id = await seed('1006', true);
    await core.requestEnrich(id, { fields: ['metadata'] });
    const injected = deps();
    injected.enrichSource.mockResolvedValue({
      ...post,
      text: 'Fresh post',
      thumbnailUrl: 'https://i.test/post.png',
    });
    await worker.enrichLink(id, injected);
    expect(injected.safeFetch).not.toHaveBeenCalled();
    expect(injected.runXPostTitle).not.toHaveBeenCalled();
    expect(await core.getById(id)).toMatchObject({
      title: 'Original page title',
      description: 'Fresh post',
      imageUrl: 'https://i.test/post.png',
      siteName: 'X',
      sourceData: post,
    });
  });

  it('source writes only source_data and never fetches or invokes AI', async () => {
    const id = await seed('1007', true);
    await core.requestEnrich(id, { fields: ['source'] });
    const injected = deps();
    injected.enrichSource.mockResolvedValue({ ...post, likes: 99 });
    await worker.enrichLink(id, injected);
    expect(injected.safeFetch).not.toHaveBeenCalled();
    expect(injected.extract).not.toHaveBeenCalled();
    expect(injected.selectReader).not.toHaveBeenCalled();
    expect(injected.runXPostTitle).not.toHaveBeenCalled();
    expect(await core.getById(id)).toMatchObject({
      title: 'Original page title',
      description: 'Original description',
      extractedText: null,
      sourceData: { ...post, likes: 99 },
      captureStatus: 'partial',
    });
  });

  it('non-X title writes only title, without Reader or source work', async () => {
    const id = await seed('title');
    await core.requestEnrich(id, { fields: ['title'] });
    const injected = deps();
    await worker.enrichLink(id, injected);
    expect(injected.enrichSource).not.toHaveBeenCalled();
    expect(injected.selectReader).not.toHaveBeenCalled();
    expect(await core.getById(id)).toMatchObject({
      title: 'New page title',
      description: 'Original description',
      siteName: null,
      imageUrl: null,
      extractedText: null,
    });
  });

  it('title + reader fetch once and write only title, Reader and its matching text', async () => {
    const id = await seed('union');
    await core.requestEnrich(id, { fields: ['title', 'reader'] });
    const injected = deps();
    await worker.enrichLink(id, injected);
    expect(injected.safeFetch).toHaveBeenCalledOnce();
    expect(injected.extract).toHaveBeenCalledOnce();
    expect(injected.selectReader).toHaveBeenCalledOnce();
    expect(injected.enrichSource).not.toHaveBeenCalled();
    expect(injected.runXPostTitle).not.toHaveBeenCalled();
    expect(await core.getById(id)).toMatchObject({
      title: 'New page title',
      description: 'Original description',
      extractedText: 'New Reader body',
      captureStatus: 'partial',
    });
    expect(await core.getStoredReader(id)).toMatchObject({ contentHtml: '<p>New Reader</p>' });
  });

  it('reader alone preserves metadata and skips source and AI', async () => {
    const id = await seed('reader');
    await core.requestEnrich(id, { fields: ['reader'] });
    const injected = deps();
    await worker.enrichLink(id, injected);
    expect(injected.enrichSource).not.toHaveBeenCalled();
    expect(injected.runXPostTitle).not.toHaveBeenCalled();
    expect(await core.getById(id)).toMatchObject({
      title: 'Original page title',
      description: 'Original description',
      extractedText: 'New Reader body',
      captureStatus: 'partial',
    });
  });

  it.each(['not-found', 'timeout'] as const)(
    '%s restores the floor with no data write, trash or give-up',
    async (reason) => {
      const id = await seed(`failure-${reason}`);
      await core.requestEnrich(id, { fields: ['metadata', 'source'] });
      await pool.query('update links set enrich_attempts = 10 where id = $1', [id]);
      const injected = deps();
      injected.safeFetch.mockResolvedValue({ ok: false, reason });
      await worker.enrichLink(id, injected);
      expect(injected.extract).not.toHaveBeenCalled();
      expect(injected.selectReader).not.toHaveBeenCalled();
      expect(await core.getById(id)).toMatchObject({
        title: 'Original page title',
        description: 'Original description',
        sourceData: { kind: 'link' },
        captureStatus: 'partial',
        enrichFields: null,
        enrichFloorStatus: null,
        enrichAttempts: 10,
        siteName: null,
      });
    },
  );

  it('a source API failure preserves the existing data and restores bare', async () => {
    const id = await seed('1008', true);
    await core.recordEnrichment(id, { status: 'bare' });
    await core.requestEnrich(id, { fields: ['source'] });
    const injected = deps();
    injected.enrichSource.mockRejectedValue(new Error('API unavailable'));
    await worker.enrichLink(id, injected);
    expect(await core.getById(id)).toMatchObject({ sourceData: post, captureStatus: 'bare' });
  });

  it('a full run still fetches, extracts, selects Reader, updates source and uses the result status', async () => {
    const id = await seed('full');
    await core.requestEnrich(id);
    const injected = deps();
    injected.enrichSource.mockResolvedValue({ kind: 'link' });
    injected.selectReader.mockResolvedValue({
      status: 'reader',
      reader: { contentHtml: '<p>Complete Reader</p>', contentImages: [] },
      text: 'Complete article. '.repeat(30),
    });
    await worker.enrichLink(id, injected);
    expect(injected.safeFetch).toHaveBeenCalledOnce();
    expect(injected.extract).toHaveBeenCalledWith(expect.not.objectContaining({ reader: false }));
    expect(injected.selectReader).toHaveBeenCalledOnce();
    expect(injected.enrichSource).toHaveBeenCalledOnce();
    expect(await core.getById(id)).toMatchObject({
      title: 'New page title',
      description: 'New description',
      imageUrl: 'https://example.org/new.png',
      sourceData: { kind: 'link' },
      captureStatus: 'full',
      enrichAttempts: 1,
    });
  });
});
