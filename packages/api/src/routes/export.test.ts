import type * as CoreOps from '@silo/core';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { expect400 } from '../test-support/assertions.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

/**
 * HTTP-level integration tests for `GET /api/export` (plan 027, U2) — the
 * full-library download route over `core.exportLinks`.
 *
 * Unlike every other route test in this package, the response body is NOT
 * JSON — it's a file body (JSON/YAML/CSV text). So these tests assert on
 * `res.headers.get('content-type')`/`'content-disposition'` and
 * `await res.text()` directly, rather than `test-support/assertions.ts`'s
 * `expectOk` (which unconditionally calls `res.json()` and would throw on a
 * YAML/CSV body). `expect400` is still used for the invalid-format case since
 * that path DOES return the shared JSON error envelope.
 *
 * ONE `setupPgHarness` for the whole file (mirrors `tags.test.ts`).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('GET /api/export (integration)', () => {
  const harness = setupPgHarness('silo_api_export_test', async () => {
    const core = (await import('@silo/core')) as typeof CoreOps;
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });

  it('no format -> 200, application/json, filename ends in .json', async () => {
    const { app } = harness.mod();
    const res = await app.request('/api/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const disposition = res.headers.get('content-disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toMatch(/silo-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = await res.text();
    const parsed = JSON.parse(body);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.links)).toBe(true);
  });

  it('?format=yaml -> 200, application/yaml, filename ends in .yaml', async () => {
    const { app } = harness.mod();
    const res = await app.request('/api/export?format=yaml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/yaml');
    expect(res.headers.get('content-disposition')).toMatch(/silo-export-\d{4}-\d{2}-\d{2}\.yaml"$/);
    const body = await res.text();
    expect(body).toContain('version:');
  });

  it('?format=csv -> 200, text/csv, filename ends in .csv, body starts with UTF-8 BOM', async () => {
    const { app } = harness.mod();
    const res = await app.request('/api/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/silo-export-\d{4}-\d{2}-\d{2}\.csv"$/);
    // Check the raw wire bytes for the UTF-8 BOM (EF BB BF), not `res.text()`:
    // the Fetch spec's UTF-8 decode consumes a leading BOM as a marker rather
    // than surfacing it as a U+FEFF character, so `text().startsWith(BOM)` is
    // always false regardless of what the server actually sent — this is what
    // `core.exportLinks`'s hand-rolled CSV serializer puts on the wire, and
    // what a real browser/Excel/`curl -O` receives.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const bodyAfterBom = new TextDecoder().decode(bytes.slice(3));
    expect(bodyAfterBom).toContain('id,url,canonicalUrl,title');
  });

  it('?format=bogus -> 400 validation_error', async () => {
    await expect400(harness.mod().app, '/api/export?format=bogus', 'validation_error');
  });

  it('seeded link appears in the JSON export body', async () => {
    const { core, app } = harness.mod();
    await core.createLink({
      url: 'https://example.com/export-route-seed',
      sourceKind: 'link',
      title: 'Export route seed link',
      tags: ['export-seed-tag'],
    });

    const res = await app.request('/api/export');
    const body = await res.text();
    const parsed = JSON.parse(body);
    const seeded = parsed.links.find(
      (l: { url: string }) => l.url === 'https://example.com/export-route-seed',
    );
    expect(seeded).toBeDefined();
    expect(seeded.title).toBe('Export route seed link');
    expect(seeded.tags).toEqual(['export-seed-tag']);
  });
});
