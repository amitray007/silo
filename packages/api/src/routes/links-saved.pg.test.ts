import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('POST /api/links/saved (disposable Postgres)', () => {
  const harness = setupPgHarness('silo_api_saved_test', async () => {
    const core = await import('@silo/core');
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });

  it('returns input URLs that canonically match live links only', async () => {
    const { core, app } = harness.mod();
    await core.createLink({ url: 'https://example.com/live', sourceKind: 'link' });
    const trashed = await core.createLink({ url: 'https://example.com/trash', sourceKind: 'link' });
    await core.softDelete(trashed.id);
    const variant = 'http://www.example.com/live/?utm_source=reader#part';
    const response = await app.request('/api/links/saved', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Silo-CSRF': '1' },
      body: JSON.stringify({ urls: [variant, trashed.url, 'https://example.com/absent'] }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: [variant] });
  });

  it('accepts 50 strings and treats invalid URLs as unsaved', async () => {
    const { app } = harness.mod();
    const response = await app.request('/api/links/saved', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Silo-CSRF': '1' },
      body: JSON.stringify({ urls: Array.from({ length: 50 }, () => 'javascript:alert(1)') }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saved: [] });
  });
});
