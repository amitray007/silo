import { z } from 'zod';

/**
 * Per-source `source_data` payload, typed and validated by a Zod
 * discriminated union keyed on `kind`.
 *
 * The discriminant field is named `kind` here (inside the JSON payload) to
 * match the plan's `source_kind` typed column (plan R2 / KTD): `source_kind`
 * is stored twice — once as a cheap, indexable SQL column, once inside the
 * JSON as `kind` so the payload is self-describing on its own. Every variant
 * must set `kind` to the same literal it's keyed under here.
 *
 * Adding a new source is a one-file change: add a variant to this union, no
 * migration needed (plan R2). Unknown/extra fields on a payload are REJECTED
 * (not silently stripped) — see the adversarial test notes in
 * `source-data.test.ts`. Rejecting rather than stripping surfaces integration
 * bugs (a typo'd field name, a schema drift from a plugin) at the write
 * boundary instead of silently discarding data the caller thought was saved.
 */

/**
 * The universal floor: a source with no source-specific metadata beyond the
 * shared `links` columns (title/description/etc). Used for plain URLs saved
 * with no richer source integration.
 */
const linkSourceData = z
  .object({
    kind: z.literal('link'),
  })
  .strict();

/**
 * Hacker News item — minimal example of a plugin-shaped source payload.
 */
const hackerNewsSourceData = z
  .object({
    kind: z.literal('hacker_news'),
    points: z.number().int().nonnegative().max(10_000_000),
    comments: z.number().int().nonnegative().max(10_000_000),
    author: z.string().min(1).max(256),
  })
  .strict();

/**
 * Twitter/X post — minimal example of a plugin-shaped source payload.
 */
const twitterSourceData = z
  .object({
    kind: z.literal('twitter'),
    likes: z.number().int().nonnegative().max(10_000_000_000),
    replies: z.number().int().nonnegative().max(10_000_000_000),
    author: z.string().min(1).max(256),
  })
  .strict();

export const sourceDataSchema = z.discriminatedUnion('kind', [
  linkSourceData,
  hackerNewsSourceData,
  twitterSourceData,
]);

export type SourceData = z.infer<typeof sourceDataSchema>;
