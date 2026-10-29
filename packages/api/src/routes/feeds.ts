import { deleteFeed, getFeed, listFeedPosts, listFeeds, subscribeFeed } from '@silo/core';
import type { Hono } from 'hono';
import { toLinkJson } from '../link-json.js';
import {
  feedIdParamSchema,
  pageQuerySchema,
  subscribeFeedSchema,
  toPageParams,
} from '../query-schemas.js';

export function registerFeedRoutes(app: Hono): void {
  app.get('/feeds', async (c) => c.json({ feeds: await listFeeds() }));
  app.post('/feeds', async (c) => {
    const input = subscribeFeedSchema.parse(await c.req.json());
    const result = await subscribeFeed(input);
    if ('error' in result) {
      const unavailable = result.error === 'feeds_unavailable';
      return c.json(
        {
          error: result.error,
          message: unavailable
            ? 'Feeds are unavailable. Try again later.'
            : 'No feed found at this URL. Try a feed URL instead.',
        },
        unavailable ? 503 : 422,
      );
    }
    return c.json(result, result.deduped ? 200 : 201);
  });
  app.get('/feeds/:id', async (c) => {
    const { id } = feedIdParamSchema.parse(c.req.param());
    const feed = await getFeed(id);
    return feed
      ? c.json({ feed })
      : c.json({ error: 'not_found', message: 'Feed not found.' }, 404);
  });
  app.delete('/feeds/:id', async (c) => {
    const { id } = feedIdParamSchema.parse(c.req.param());
    return (await deleteFeed(id))
      ? c.body(null, 204)
      : c.json({ error: 'not_found', message: 'Feed not found.' }, 404);
  });
  app.get('/feeds/:id/posts', async (c) => {
    const { id } = feedIdParamSchema.parse(c.req.param());
    const page = toPageParams(pageQuerySchema.parse(c.req.query()));
    if (!(await getFeed(id)))
      return c.json({ error: 'not_found', message: 'Feed not found.' }, 404);
    const result = await listFeedPosts(id, page);
    return c.json({
      ...result,
      links: result.links.map((link) => ({
        ...toLinkJson(link),
        publishedAt: link.publishedAt?.toISOString() ?? null,
      })),
    });
  });
}
