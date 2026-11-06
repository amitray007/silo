import { expect, it, vi } from 'vitest';
import { describeMcpTool, expectNoLeakedFields } from './test-support/mcp-server-harness.js';

describeMcpTool('silo_clean_shape_test', 'clean link shape', (getContext) => {
  it('skips cleaning settings on count, ids-only, and missing-link paths', async () => {
    const { core, client } = getContext();
    const cleaner = vi.spyOn(core, 'loadUrlCleaner');
    const missing = '00000000-0000-4000-8000-000000000001';
    try {
      for (const [name, args] of [
        ['list_links', { count_only: true }],
        ['add_link_tag', { ids: [missing], tag: 'test' }],
        ['remove_link_tag', { ids: [missing], tag: 'test' }],
        ['retry_capture', { ids: [missing] }],
        ['restore_link', { ids: [missing] }],
        ['add_link_tag', { id: missing, tag: 'test' }],
        ['remove_link_tag', { id: missing, tag: 'test' }],
        ['retry_capture', { id: missing }],
        ['restore_link', { id: missing }],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).toBeFalsy();
      }
      expect(cleaner).not.toHaveBeenCalled();
    } finally {
      cleaner.mockRestore();
    }
  });
  it('shapes detail and discovery with clean and original URLs', async () => {
    const { core } = getContext();
    const raw = 'https://m.youtube.com/watch?v=1&si=tracking';
    const { id } = await core.createLink({ url: raw, sourceKind: 'link' });
    const link = await core.getById(id);
    if (!link) throw new Error('missing fixture');
    const { toBaseLinkContent, toSnippetLinkContent } = await import('./link-shape.js');
    const cleaner = await core.loadUrlCleaner();
    for (const result of [
      toBaseLinkContent(link, cleaner),
      toSnippetLinkContent({ ...link, snippet: null }, cleaner),
    ]) {
      expect(result.url).toBe('https://m.youtube.com/watch?v=1');
      expect(result.originalUrl).toBe(raw);
      expectNoLeakedFields(result);
    }
  });
});
