import { sql } from 'drizzle-orm';
import { buildSnippetHeadline } from '../links/links.js';
import { whereFeed } from '../links/live.js';
import type { PageParams } from '../links/pagination.js';
import { runUnionSearch } from '../links/search-query.js';

/** Search one feed's Inbox and Archive with the library's matching and ranking. */
export function searchFeedPosts(feedId: string, query: string, page: PageParams = {}) {
  return runUnionSearch(
    whereFeed(feedId),
    sql`to_tsvector('english', '')`,
    query,
    undefined,
    page,
    {
      snippetFor: buildSnippetHeadline,
    },
  );
}
