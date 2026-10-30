import { links } from '@silo/db';
import { and, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';

/** Home, tags, search, and other library collections exclude feed posts. */
export function whereLibrary(...conditions: ReadonlyArray<SQL | undefined>): SQL {
  const predicate = and(isNull(links.deletedAt), isNull(links.feedId), ...conditions);
  if (!predicate) throw new Error('whereLibrary: missing predicate');
  return predicate;
}

/** Live posts belonging to exactly one feed. */
export function whereFeed(feedId: string, ...conditions: ReadonlyArray<SQL | undefined>): SQL {
  const predicate = and(isNull(links.deletedAt), eq(links.feedId, feedId), ...conditions);
  if (!predicate) throw new Error('whereFeed: missing predicate');
  return predicate;
}

/** Trashed library links exclude feed posts. */
export function whereTrashedLibrary(...conditions: ReadonlyArray<SQL | undefined>): SQL {
  const predicate = and(isNotNull(links.deletedAt), isNull(links.feedId), ...conditions);
  if (!predicate) throw new Error('whereTrashedLibrary: missing predicate');
  return predicate;
}

/** by-id lookups span library and feed posts */
export function whereLiveAnywhere(...conditions: ReadonlyArray<SQL | undefined>): SQL {
  const predicate = and(isNull(links.deletedAt), ...conditions);
  if (!predicate) throw new Error('whereLiveAnywhere: missing predicate');
  return predicate;
}
