import { expect, it } from 'vitest';
import { describeMcpTool } from './test-support/mcp-server-harness.js';

describeMcpTool('silo_mcp_clean_url', 'clean_url parity', (getContext) => {
  it('uses saved owner rules and preserves the captured URL', async () => {
    const { core, client } = getContext();
    await core.setSetting('linkCleaning', { enabled: true, everySite: ['ref'], sites: [] });
    const url = 'https://example.com/a?ref=x&utm_source=keep#hash';
    expect(
      (await client.callTool({ name: 'clean_url', arguments: { url } })).structuredContent,
    ).toEqual({
      url: 'https://example.com/a?utm_source=keep#hash',
      originalUrl: url,
      removed: ['ref'],
    });
    await core.setSetting('linkCleaning', { enabled: false, everySite: ['ref'], sites: [] });
    expect(
      (await client.callTool({ name: 'clean_url', arguments: { url } })).structuredContent,
    ).toEqual({ url, originalUrl: url, removed: [] });
  });
  it('describes served and original URLs in link results', async () => {
    const { tools } = await getContext().client.listTools();
    const schema = JSON.stringify(tools.find((tool) => tool.name === 'list_links')?.outputSchema);
    expect(schema).toContain('The URL exactly as captured.');
    expect(schema).toContain("owner's link-cleaning setting");
  });
  it('returns tool errors for non-http input', async () => {
    for (const url of ['mailto:a@example.com', 'broken', 'ftp://example.com']) {
      expect(
        (await getContext().client.callTool({ name: 'clean_url', arguments: { url } })).isError,
      ).toBe(true);
    }
  });
});
