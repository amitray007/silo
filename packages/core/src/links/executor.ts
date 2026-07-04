import type { db, links } from '@silo/db';
import type { InferSelectModel } from 'drizzle-orm';

/**
 * Shared executor types — the pooled `db` singleton or a transaction handle.
 * Extracted here (rather than living in `links.ts`) so `enqueue.ts` can
 * reference them without importing `links.ts`, which imports `enqueue.ts` — a
 * cycle the `no-circular` boundary rule forbids.
 */
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executor = Db | Tx;

/**
 * A single `links` row, typed. Defined here (not in `links.ts`) so
 * `pagination.ts` can reference it without importing `links.ts`, which
 * imports `pagination.ts` — a cycle the `no-circular` boundary rule forbids.
 * Re-exported from `links.ts` for callers.
 */
export type Link = InferSelectModel<typeof links>;
