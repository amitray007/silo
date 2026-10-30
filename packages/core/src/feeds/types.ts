import type { SourceData } from '../links/source-data.js';

export type FeedEntry = {
  id?: string;
  url: string;
  title?: string;
  publishedAt?: Date | null;
  media?: Extract<SourceData, { kind: 'feed_media' }>;
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

/** Accept publisher hostnames while preserving explicit schemes for edge validation. */
export function normalizeFeedUrl(url: string): string {
  const value = url.trim();
  const hasScheme =
    value.includes('://') ||
    /^(?:mailto|javascript|data|tel|sms|urn|about|blob|file|http|https|ftp):/i.test(value);
  return hasScheme ? value : `https://${value}`;
}
