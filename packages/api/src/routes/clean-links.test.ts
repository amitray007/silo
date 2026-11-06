import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import type { LinkJson } from '../link-json.js';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('clean links routes', () => {
  const harness = setupPgHarness('silo_clean_links_test', async () => {
    const core = await import('@silo/core');
    const { createApp } = await import('../app.js');
    return { core, app: createApp() };
  });
  it('returns defaults and previews saved owner rules', async () => {
    const { core, app } = harness.mod();
    expect(await (await app.request('/api/links/clean-defaults')).json()).toEqual(
      core.LINK_CLEANING_DEFAULTS,
    );
    const config = { enabled: true, everySite: ['custom'], sites: [] };
    const saved = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkCleaning: config }),
    });
    expect(saved.status).toBe(200);
    const result = await app.request('/api/links/clean-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/?custom=x&q=1' }),
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      url: 'https://example.com/?q=1',
      originalUrl: 'https://example.com/?custom=x&q=1',
      removed: ['custom'],
    });
  });
  it('serves cleaned library and trash URLs without rewriting stored URLs', async () => {
    const { app, core } = harness.mod();
    await core.setSetting('linkCleaning', core.LINK_CLEANING_DEFAULTS);
    const raw = 'https://example.com/api-clean-surface?utm_source=x&q=1';
    const { id } = await core.createLink({ url: raw, sourceKind: 'link' });
    const detail = (await (await app.request(`/api/links/${id}`)).json()) as { link: LinkJson };
    expect(detail.link).toMatchObject({
      url: 'https://example.com/api-clean-surface?q=1',
      originalUrl: raw,
    });
    const page = (await (await app.request('/api/links')).json()) as { links: LinkJson[] };
    expect(page.links.find((link: { id: string }) => link.id === id)).toMatchObject({
      url: 'https://example.com/api-clean-surface?q=1',
      originalUrl: raw,
    });
    expect((await core.getById(id))?.url).toBe(raw);
    await core.softDelete(id);
    const trash = (await (await app.request('/api/trash')).json()) as { links: LinkJson[] };
    expect(trash.links.find((link: { id: string }) => link.id === id)).toMatchObject({
      url: 'https://example.com/api-clean-surface?q=1',
      originalUrl: raw,
    });
  });
  it('allows linkCleaning bodies above 16 KB and rejects above 128 KB', async () => {
    const { app } = harness.mod();
    const config = {
      enabled: true,
      everySite: Array.from({ length: 500 }, (_, i) => `param${i}${'x'.repeat(90)}`),
      sites: [],
    };
    const send = (body: unknown) =>
      app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await send({ linkCleaning: config })).status).toBe(200);
    expect(
      (await send({ linkCleaning: config, reader: { fontFamily: 'x'.repeat(17000) } })).status,
    ).toBe(413);
    expect(
      (await send({ linkCleaning: { ...config, everySite: ['x'.repeat(128 * 1024)] } })).status,
    ).toBe(413);
  });
  it.each(['garbage', 'mailto:a@example.com', 'javascript:alert(1)'])('rejects %s', async (url) => {
    const response = await harness.mod().app.request('/api/links/clean-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'validation_error' });
  });
});
