import { bucketByDay } from '../buckets.js';
import type { Client } from '../client.js';
import { bold, dim, formatLinkLine } from '../format.js';
import type { LinkJson } from '../types.js';

export type ListOptions = {
  tag?: string;
  limit?: number;
  json: boolean;
};

const PAGE_SIZE = 100;

/**
 * Fetches up to `limit` links (across as many pages as needed — `core`'s
 * default page size is smaller than most `--limit` values a user would
 * pass), following `nextCursor` until either `limit` is reached or the feed
 * runs out. No `limit` means "one page" (mirrors the web Library's initial
 * load — `silo list` isn't expected to dump the entire store by default).
 */
async function fetchLinks(
  client: Client,
  params: { tag?: string; limit?: number },
): Promise<LinkJson[]> {
  const target = params.limit;
  const links: LinkJson[] = [];
  let cursor: string | undefined;

  do {
    const pageParams: { tag?: string; limit?: number; cursor?: string } = {
      limit: PAGE_SIZE,
    };
    if (params.tag !== undefined) pageParams.tag = params.tag;
    if (cursor !== undefined) pageParams.cursor = cursor;

    const page = await client.list(pageParams);
    links.push(...page.links);
    cursor = page.nextCursor;
  } while (cursor !== undefined && (target === undefined || links.length < target));

  return target !== undefined ? links.slice(0, target) : links;
}

/** `silo list [--tag] [--limit]` — the day-grouped feed, formatted like the web UI's Today/Yesterday/date grouping. */
export async function runList(client: Client, options: ListOptions): Promise<void> {
  const params: { tag?: string; limit?: number } = {};
  if (options.tag !== undefined) params.tag = options.tag;
  if (options.limit !== undefined) params.limit = options.limit;

  const links = await fetchLinks(client, params);

  if (options.json) {
    console.log(JSON.stringify({ links }));
    return;
  }

  if (links.length === 0) {
    console.log(dim(options.tag ? `No links tagged "${options.tag}".` : 'No links yet.'));
    return;
  }

  const buckets = bucketByDay(links);
  for (const bucket of buckets) {
    console.log(bold(bucket.label));
    for (const link of bucket.items) {
      console.log(`  ${formatLinkLine(link)}`);
    }
    console.log('');
  }
}
