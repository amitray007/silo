import {
  deleteFeed,
  feedTitleSchema,
  getFeed,
  listFeedPosts,
  listFeeds,
  refreshFeed,
  renameFeed,
  saveFeedPost,
  setFeedPostArchived,
  subscribeFeed,
} from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { toLinkJson } from '../link-json.js';
import {
  feedIdParamSchema,
  feedPostParamSchema,
  feedPostsQuerySchema,
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
  app.patch('/feeds/:id', async (c) => {
    const { id } = feedIdParamSchema.parse(c.req.param());
    const { title } = z.object({ title: feedTitleSchema }).parse(await c.req.json());
    const feed = await renameFeed(id, title);
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
  app.post('/feeds/:id/refresh', async (c) => {
    const { id } = feedIdParamSchema.parse(c.req.param());
    const result = await refreshFeed(id);
    if (!('error' in result)) return c.json(result, 202);
    const unavailable = result.error === 'feeds_unavailable';
    return c.json(
      {
        error: result.error,
        message: unavailable ? 'Feed refresh is unavailable. Try again later.' : 'Feed not found.',
      },
      unavailable ? 503 : 404,
    );
  });
  for (const action of ['archive', 'unarchive'] as const) {
    app.post(`/feeds/:id/posts/:postId/${action}`, async (c) => {
      const { id, postId } = feedPostParamSchema.parse(c.req.param());
      const result = await setFeedPostArchived(id, postId, action === 'archive');
      if ('error' in result)
        return c.json(
          {
            error: result.error,
            message:
              result.error === 'not_feed_post'
                ? 'This link is not a feed post.'
                : 'Feed post not found.',
          },
          result.error === 'not_feed_post' ? 409 : 404,
        );
      return c.json(result);
    });
  }
  app.post('/feeds/:id/posts/:postId/save', async (c) => {
    const { id, postId } = feedPostParamSchema.parse(c.req.param());
    const result = await saveFeedPost(id, postId);
    if ('error' in result)
      return c.json(
        {
          error: result.error,
          message:
            result.error === 'not_feed_post'
              ? 'This link is not a feed post.'
              : 'Feed post not found.',
        },
        result.error === 'not_feed_post' ? 409 : 404,
      );
    return c.json(result, result.outcome === 'created' ? 201 : 200);
  });
  app.get('/feeds/:id/posts', async (c) => {
    const { id } = feedIdParamSchema.parse(c.req.param());
    const query = feedPostsQuerySchema.parse(c.req.query());
    const page = { ...toPageParams(query), tab: query.tab };
    if (!(await getFeed(id)))
      return c.json({ error: 'not_found', message: 'Feed not found.' }, 404);
    const result = await listFeedPosts(id, page);
    return c.json({
      ...result,
      links: result.links.map(toLinkJson),
    });
  });
}
