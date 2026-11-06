import { expect, it } from 'vitest';
import { describeMcpTool, expectNoLeakedFields } from './test-support/mcp-server-harness.js';

describeMcpTool('silo_clean_shape_test', 'clean link shape', (getContext) => {
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
