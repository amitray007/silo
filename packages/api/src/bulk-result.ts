import { TooManyIdsError } from '@silo/core';
import type { Context } from 'hono';

/**
 * Runs a bulk `core` call (`op`), catching `TooManyIdsError` and mapping it to
 * a clean `400 validation_error` JSON response instead of letting it fall
 * through to the app's generic `onError` (which would still produce a
 * sensible envelope via `ZodError`/fallback handling, but with a less
 * specific message than the ceiling itself can give). Mirrors
 * `found-result.ts`'s `runBulkGuarded` on the MCP side: the ONE place that
 * owns "try the bulk call, turn an oversized batch into a clean error" so
 * each batch route's handler is a single call here rather than a hand-copied
 * try/catch (jscpd risk otherwise, same as the MCP side's five-tool repeat
 * the U4 review flagged).
 *
 * Returns a discriminated `{ ok: true, value } | { ok: false, response }`
 * (not a union of `T | Response`) so a caller can `if (!outcome.ok) return
 * outcome.response;` without a type-guard — mirrors `runBulkGuarded`'s own
 * doc comment on why a plain union would be ambiguous to narrow.
 */
export async function runBulkGuarded<T>(
  c: Context,
  op: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await op() };
  } catch (error) {
    if (error instanceof TooManyIdsError) {
      return {
        ok: false,
        response: c.json({ error: 'validation_error', message: error.message }, 400),
      };
    }
    throw error;
  }
}
