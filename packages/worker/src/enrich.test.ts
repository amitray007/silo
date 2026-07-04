import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EnrichLinkDeps } from './enrich.js';
import type { ExtractResult } from './extract/extract.js';
import type { SafeFetchResult } from './fetch/safe-fetch.js';

/**
 * Integration tests for the enrichment handler (U5). `enrichLink` calls core's
 * `getById`/`recordEnrichment`, so it needs a real Postgres — but the network
 * (`safeFetch`) and DOM parsing (`extract`) are injected via `EnrichLinkDeps`,
 * so the handler's mapping + resolve-on-degraded contract is tested without
 * touching the network. Core's `db`/`pool` singleton reads DATABASE_URL at
 * module-load, so both `@silo/core` and `./enrich.js` are dynamically imported
 * after the env var is set.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('enrichLink (integration)', () => {
  let dropDatabase: () => void;
  let core: typeof import('@silo/core');
  let enrichMod: typeof import('./enrich.js');
  let pool: Pool;

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_worker_enrich_test');
    dropDatabase = database.drop;
    const migratePool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');

    process.env.DATABASE_URL = database.url;
    core = await import('@silo/core');
    enrichMod = await import('./enrich.js');
    pool = new Pool({ connectionString: database.url });
  });

  afterAll(async () => {
    const { pool: corePool } = await import('@silo/db');
    await corePool.end();
    await pool.end();
    dropDatabase();
  });

  function stubDeps(fetchResult: SafeFetchResult, extractResult?: ExtractResult): EnrichLinkDeps {
    return {
      safeFetch: () => Promise.resolve(fetchResult),
      extract: () => Promise.resolve(extractResult ?? { status: 'bare' }),
    };
  }

  async function newLink(url: string): Promise<string> {
    const link = await core.createLink({ url, sourceKind: 'link' });
    return link.id;
  }

  it('fetch ok + extract full -> records full with metadata', async () => {
    const id = await newLink('https://example.com/full');
    await enrichMod.enrichLink(
      id,
      stubDeps(
        {
          ok: true,
          html: '<html></html>',
          contentType: 'text/html',
          finalUrl: 'https://example.com/full',
          status: 200,
        },
        {
          title: 'T',
          description: 'D',
          imageUrl: 'https://i',
          siteName: 'S',
          text: 'x'.repeat(400),
          status: 'full',
        },
      ),
    );
    const link = await core.getById(id);
    expect(link?.captureStatus).toBe('full');
    expect(link?.title).toBe('T');
    expect(link?.extractedText).toBe('x'.repeat(400));
  });

  it('fetch ok + extract partial (JS-wall) -> records partial', async () => {
    const id = await newLink('https://example.com/partial');
    await enrichMod.enrichLink(
      id,
      stubDeps(
        {
          ok: true,
          html: '<html></html>',
          contentType: 'text/html',
          finalUrl: 'https://example.com/partial',
          status: 200,
        },
        { title: 'Shell', status: 'partial' },
      ),
    );
    expect((await core.getById(id))?.captureStatus).toBe('partial');
  });

  it('fetch blocked-ip -> records bare and RESOLVES (no throw, no retry storm)', async () => {
    const id = await newLink('https://example.com/blocked');
    await expect(
      enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'blocked-ip' })),
    ).resolves.toBeUndefined();
    expect((await core.getById(id))?.captureStatus).toBe('bare');
  });

  it('fetch timeout -> records partial (reachable resource, retry may succeed)', async () => {
    const id = await newLink('https://example.com/timeout');
    await enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'timeout' }));
    expect((await core.getById(id))?.captureStatus).toBe('partial');
  });

  it('fetch oversized body -> records partial', async () => {
    const id = await newLink('https://example.com/big');
    await enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'body-too-large' }));
    expect((await core.getById(id))?.captureStatus).toBe('partial');
  });

  it('a vanished link (deleted between enqueue and processing) is a no-op, not an error', async () => {
    const id = await newLink('https://example.com/gone');
    await core.softDelete(id);
    await expect(
      enrichMod.enrichLink(
        id,
        stubDeps(
          {
            ok: true,
            html: '<html></html>',
            contentType: 'text/html',
            finalUrl: 'https://example.com/gone',
            status: 200,
          },
          { title: 'X', status: 'full' },
        ),
      ),
    ).resolves.toBeUndefined();
    // Still trashed, never enriched.
    const rows = await pool.query('select capture_status, deleted_at from links where id = $1', [
      id,
    ]);
    expect(rows.rows[0]?.deleted_at).not.toBeNull();
    expect(rows.rows[0]?.capture_status).toBe('enriching');
  });

  it('never records enriching as a result (degraded capture is terminal)', async () => {
    const id = await newLink('https://example.com/term');
    await enrichMod.enrichLink(id, stubDeps({ ok: false, reason: 'dns-error' }));
    expect((await core.getById(id))?.captureStatus).not.toBe('enriching');
  });

  it('PROPAGATES an unexpected error (the pg-boss retry signal), not swallow it', async () => {
    // The resolve-vs-throw contract: an UNEXPECTED failure (here, extract
    // throwing — it is contracted never-to-throw, so a throw is a real defect)
    // must propagate so pg-boss retries + eventually dead-letters, rather than
    // being silently recorded as a degraded capture. The link is left untouched
    // at `enriching` so the retry re-runs cleanly.
    const id = await newLink('https://example.com/throws');
    await expect(
      enrichMod.enrichLink(id, {
        safeFetch: () =>
          Promise.resolve({
            ok: true,
            html: '<html></html>',
            contentType: 'text/html',
            finalUrl: 'https://example.com/throws',
            status: 200,
          }),
        extract: () => Promise.reject(new Error('unexpected extract crash')),
      }),
    ).rejects.toThrow('unexpected extract crash');
    // Untouched — the failed attempt recorded nothing; a retry starts fresh.
    expect((await core.getById(id))?.captureStatus).toBe('enriching');
  });
});
