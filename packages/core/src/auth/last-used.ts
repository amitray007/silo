import { accessTokens, db } from '@silo/db';
import { and, eq, sql } from 'drizzle-orm';

/**
 * `access_tokens.last_used_at` bookkeeping, throttled.
 *
 * Every authenticated request used to write the row, which costs a write plus a row lock per
 * request on the hottest path in the app. The column is shown in the Access tab as "last used",
 * so it only needs to be right to the minute: it is rewritten only when the stored value is
 * older than `LAST_USED_REFRESH_SECONDS` (or still null). Accuracy: the shown time is never more
 * than that many seconds behind the real last use.
 *
 * Staleness is judged by the database clock inside the same statement that writes, so two
 * concurrent requests (or the API and MCP processes) cannot both write inside one window, and
 * clock skew between app and database cannot matter.
 */
export const LAST_USED_REFRESH_SECONDS = 60;

/** SQL predicate: this row's `last_used_at` is missing or older than the refresh window. */
export const lastUsedIsStale = sql<boolean>`(${accessTokens.lastUsedAt} is null or ${accessTokens.lastUsedAt} < now() - make_interval(secs => ${LAST_USED_REFRESH_SECONDS}))`;

/**
 * Best-effort write of `last_used_at = now()` for a token that just authenticated. A no-op when
 * the stored value is still fresh. Never throws: bookkeeping must not fail a valid credential.
 */
export async function touchLastUsed(tokenId: string): Promise<void> {
  try {
    await db
      .update(accessTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(and(eq(accessTokens.id, tokenId), lastUsedIsStale));
  } catch {
    // Best-effort bookkeeping only — a failure here must never fail auth.
  }
}
