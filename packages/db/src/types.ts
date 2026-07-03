import { customType } from 'drizzle-orm/pg-core';

/**
 * Postgres `tsvector` — not a built-in Drizzle column type. Used only as the
 * target of a `GENERATED ALWAYS AS ... STORED` expression (see
 * `schema/links.ts`); the JS-side representation is a plain string, which is
 * all a generated, read-only column needs (never written to directly).
 */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});
