export type FeedEntry = {
  id?: string;
  url: string;
  title?: string;
  publishedAt?: Date | null;
};

export type ResolvedFeed = {
  feedUrl: string;
  siteUrl: string;
  title: string;
  description?: string;
  format: 'rss' | 'atom' | 'rdf' | 'json';
  entries: FeedEntry[];
  etag?: string;
  lastModified?: string;
  intervalSeconds: number;
};

export type FeedPollResult =
  | { kind: 'modified'; feed: ResolvedFeed }
  | { kind: 'not-modified'; intervalSeconds?: number; etag?: string; lastModified?: string }
  | { kind: 'failure'; message: string; gone?: boolean; retryAfterSeconds?: number };

export type FeedResolver = (url: string) => Promise<ResolvedFeed | null>;
let resolver: FeedResolver | undefined;
export function setFeedResolver(next: FeedResolver | undefined): void {
  resolver = next;
}
export function getFeedResolver(): FeedResolver | undefined {
  return resolver;
}
