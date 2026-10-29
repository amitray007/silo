import { expect, it } from 'vitest';
import { describeMcpTool, seedLink } from './test-support/mcp-server-harness.js';

describeMcpTool('silo_mcp_rename', 'rename parity', (getContext) => {
  it('sets and clears feed owner titles through the shared core', async () => {
    const { core, client } = getContext();
    core.setFeedResolver(async () => ({
      feedUrl: 'https://example.com/rename',
      siteUrl: 'https://example.com',
      title: 'Fetched',
      format: 'rss',
      entries: [],
      intervalSeconds: 3600,
    }));
    const result = await core.subscribeFeed({
      url: 'https://example.com/rename',
      syncRecents: true,
    });
    if ('error' in result) throw new Error(result.error);
    const feedId = result.feed.id;
    expect(
      (await client.callTool({ name: 'rename_feed', arguments: { feedId, title: '  Mine  ' } }))
        .structuredContent,
    ).toMatchObject({ found: true, feed: { title: 'Mine' } });
    expect(
      (await client.callTool({ name: 'rename_feed', arguments: { feedId, title: null } }))
        .structuredContent,
    ).toMatchObject({ feed: { title: 'Fetched' } });
    core.setFeedResolver(undefined);
  });
  it('requires merge confirmation and preserves tags through rename_tag', async () => {
    const { core, client } = getContext();
    const id = await seedLink(getContext, 'https://example.com/rename-tag');
    await core.addTag(id, 'Old');
    await core.createTag('Existing');
    const conflict = await client.callTool({
      name: 'rename_tag',
      arguments: { name: 'Old', newName: 'Existing' },
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.structuredContent).toMatchObject({ error: 'tag_exists' });
    expect(
      (
        await client.callTool({
          name: 'rename_tag',
          arguments: { name: 'Old', newName: 'Existing', merge: true },
        })
      ).structuredContent,
    ).toEqual({ name: 'Existing', merged: true });
    expect((await core.getById(id))?.tags).toEqual(['Existing']);
    const longName = 'x'.repeat(201);
    await core.createTag(longName);
    expect(
      (
        await client.callTool({
          name: 'rename_tag',
          arguments: { name: longName, newName: 'Shorter' },
        })
      ).structuredContent,
    ).toEqual({ name: 'Shorter', merged: false });
  });
});
