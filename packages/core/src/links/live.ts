import { links } from '@silo/db';
import type { SQL } from 'drizzle-orm';
import { and, isNull } from 'drizzle-orm';

/**
 * Shared live-row predicate: `deleted_at IS NULL`. Every read in `links.ts`
 * composes its own conditions through this helper so no query can forget to
 * exclude trashed rows (plan R9) — the exclusion lives in one place instead
 * of being repeated (and potentially missed) at every call site.
 *
 * `conditions` are ANDed alongside the live predicate. Pass none to select
 * "every live row".
 */
export function whereLive(...conditions: ReadonlyArray<SQL | undefined>): SQL {
  const combined = and(...conditions, isNull(links.deletedAt));
  // `and()` only returns `undefined` when given zero defined conditions; we
  // always pass at least the live predicate, so this is always defined.
  if (!combined) {
    throw new Error('whereLive: and() unexpectedly produced no condition');
  }
  return combined;
}
