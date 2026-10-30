import {
  deleteFeed,
  feedExists,
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
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { toSummaryLinkJson } from '../link-json.js';
import {
  feedIdParamSchema,
  feedPostParamSchema,
  feedPostsQuerySchema,
  subscribeFeedSchema,
  toPageParams,
} from '../query-schemas.js';

function feedNotFound(c: Context) {
  return c.json({ error: 'not_found', message: 'Feed not found.' }, 404);
}

function feedPostError(c: Context, error: 'not_feed_post' | 'not_found') {
  return c.json(
    {
      error,
      message: error === 'not_feed_post' ? 'This link is not a feed post.' : 'Feed post not found.',
    },
    error === 'not_feed_post' ? 409 : 404,
  );
}

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
    return feed ? c.json({ feed }) : feedNotFound(c);
  });
  app.patch('/feeds/:id', async (c) => {
    const { id } = feedIdParamSchema.parse(c.req.param());
    const { title } = z.object({ title: feedTitleSchema }).parse(await c.req.json());
    const feed = await renameFeed(id, title);
    return feed ? c.json({ feed }) : feedNotFound(c);
  });
  app.delete('/feeds/:id', async (c) => {
    const { id } = feedIdParamSchema.parse(c.req.param());
    return (await deleteFeed(id)) ? c.body(null, 204) : feedNotFound(c);
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
      if ('error' in result) return feedPostError(c, result.error);
      return c.json(result);
    });
  }
  app.post('/feeds/:id/posts/:postId/save', async (c) => {
    const { id, postId } = feedPostParamSchema.parse(c.req.param());
    const result = await saveFeedPost(id, postId);
    if ('error' in result) return feedPostError(c, result.error);
    return c.json(result, result.outcome === 'created' ? 201 : 200);
  });
  app.get('/feeds/:id/posts', async (c) => {
    const { id } = feedIdParamSchema.parse(c.req.param());
    const query = feedPostsQuerySchema.parse(c.req.query());
    const page = { ...toPageParams(query), tab: query.tab };
    if (!(await feedExists(id))) return feedNotFound(c);
    const result = await listFeedPosts(id, page);
    return c.json({
      ...result,
      links: result.links.map(toSummaryLinkJson),
    });
  });
}
