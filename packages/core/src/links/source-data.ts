import { z } from 'zod';
import { httpUrl } from './http-url.js';

const feedUrlSchema = z
  .string()
  .max(65_536)
  .refine((value) => httpUrl(value) !== undefined);
/** Publisher show notes are untrusted HTML. Only the worker's Reader sanitizer renders them. */
const feedMediaSourceData = z
  .object({
    kind: z.literal('feed_media'),
    content: z.string().max(1_048_576),
    description: z.string().max(20_000).optional(),
    imageUrl: feedUrlSchema.optional(),
    enclosureUrl: feedUrlSchema.optional(),
    contentBaseUrl: feedUrlSchema.optional(),
  })
  .strict();

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
 * Twitter/X post — rich payload (CLI-foundation slice, plan 020). Extended
 * from the original minimal `{likes, replies, author}` shape to carry Field
 * Theory's full bookmark export (`docs/plans/refs/fieldtheory-bookmarks-
 * schema.md`), since silo cannot fetch a tweet itself (X blocks server-side
 * fetches — see `packages/worker/src/enrich-source/index.ts`'s `'twitter'`
 * comment). The ingest command (plan 019, not built in this slice) supplies
 * this payload pre-extracted at capture time via the trusted `/api/ingest`
 * seam (`packages/api/src/routes/ingest.ts`).
 *
 * All DISPLAY data, `.strict()` (unknown fields rejected, not stripped — same
 * discipline as every other variant here), every field explicitly BOUNDED:
 * this is jsonb sourced from an EXTERNAL system (X, via Field Theory's
 * scrape), so no unbounded string/array can reach storage.
 *
 * RENDERER SAFETY (ce-security review SEC-2): Reader renders `text` as a JSX
 * text child and `mediaUrls`/`thumbnailUrl` only through the API's
 * `/source-media` proxy, which accepts https URLs on X's media hosts and never
 * hands the browser the raw URL. `text`/`authorName`/`authorHandle` are free-form external
 * strings, and `authorAvatarUrl`/`mediaUrls`/`externalLinks` are external URLs
 * validated here only for LENGTH, not scheme. Whoever builds the future
 * twitter card MUST treat them as untrusted: HTML-escape the text fields on
 * render (React JSX auto-escapes text children — do NOT bypass with
 * `dangerouslySetInnerHTML`), and scheme-allowlist the URL fields to
 * `http(s)` only before using them as `src`/`href` (reject `javascript:`/
 * `data:`, mirroring `canonicalize`'s discipline for the top-level `url`). The
 * bounds here stop jsonb bloat; they do NOT sanitize content for display.
 *
 * `author` DECISION (grep run first — see plan 020/Unit 1): no code outside
 * this file's own tests read `.author` off a twitter `sourceData` value
 * (the only other reference was `packages/web/src/api/types.ts`'s mirrored
 * type declaration, updated alongside this file). Nothing reads the field at
 * runtime, so it is REPLACED — not kept alongside — by the more useful
 * `authorHandle`/`authorName` pair (FT gives both; a single flattened
 * "author" string loses the handle/display-name distinction the web's
 * future twitter card wants). `likes`/`replies` NAMES are kept unchanged for
 * continuity per the plan, with `reposts`/`quotes`/`bookmarks` added
 * alongside to carry FT's full `engagement` object.
 */

/**
 * One post of the author's own thread (a self-reply chain), stored next to the
 * saved post as `threadBefore` / `threadAfter`. Display data only, bounded like
 * the saved post's fields. Name, handle and avatar are not repeated: every
 * stored thread post is by the saved post's author. `text` may be empty so a
 * media-only post keeps its place in the chain.
 */
export const twitterThreadPostSchema = z
  .object({
    /** The post's numeric X id. */
    id: z.string().regex(/^\d{1,32}$/),
    text: z.string().max(4_000),
    /** Raw `created_at`, stored as given like the saved post's `postedAt`. */
    postedAt: z.string().min(1).max(64).optional(),
    likes: z.number().int().nonnegative().max(10_000_000_000).optional(),
    reposts: z.number().int().nonnegative().max(10_000_000_000).optional(),
    replies: z.number().int().nonnegative().max(10_000_000_000).optional(),
    /** Same rules and limits as the saved post's `mediaUrls`. */
    mediaUrls: z.array(z.string().min(1).max(2_000)).max(64).optional(),
    /** The post's video still or first photo, like the saved post's `thumbnailUrl`. */
    thumbnailUrl: z.string().min(1).max(2_000).optional(),
  })
  .strict();

/** The most posts kept on each side of the saved post. */
export const THREAD_SIDE_MAX = 25;

const twitterSourceData = z
  .object({
    kind: z.literal('twitter'),
    /** The tweet body (FT's `text`). */
    text: z.string().min(1).max(4_000),
    authorHandle: z.string().min(1).max(256),
    authorName: z.string().min(1).max(256),
    /** FT's `authorProfileImageUrl` (pbs.twimg.com). Optional — not every
     * scraped author record carries one. */
    authorAvatarUrl: z.string().min(1).max(2_000).optional(),
    /** Engagement counts (FT's `engagement.{likeCount,repostCount,replyCount,
     * quoteCount,bookmarkCount}`). `likes`/`replies` names kept from the
     * original minimal variant for continuity; `reposts`/`quotes`/`bookmarks`
     * added to carry the rest of FT's engagement object. */
    likes: z.number().int().nonnegative().max(10_000_000_000),
    reposts: z.number().int().nonnegative().max(10_000_000_000),
    replies: z.number().int().nonnegative().max(10_000_000_000),
    quotes: z.number().int().nonnegative().max(10_000_000_000),
    bookmarks: z.number().int().nonnegative().max(10_000_000_000),
    /** FT's `postedAt` (Twitter's own date format, e.g. `Mon Jul 06 14:25:00
     * +0000 2026`) — stored as given, not reparsed/reformatted here. */
    postedAt: z.string().min(1).max(64).optional(),
    /** 2-letter language code (FT's `language`, e.g. `en`). */
    language: z.string().length(2).optional(),
    possiblySensitive: z.boolean().optional(),
    /** Media URLs (FT's `media` — twimg.com URLs). Bounded count + per-url
     * length so a pathological scrape can't bloat the stored jsonb. */
    mediaUrls: z.array(z.string().min(1).max(2_000)).max(64).optional(),
    /** External links embedded in the tweet (FT's `links`) — kept as
     * metadata on this row, per the plan's locked mapping decision (1
     * bookmark -> 1 silo link, external URLs are NOT split into separate
     * silo entries). */
    externalLinks: z.array(z.string().min(1).max(2_000)).max(64).optional(),
    /**
     * The tweet's own media thumbnail (a video's poster frame or a photo's
     * url — `pbs.twimg.com`), populated by the LIVE FxEmbed enricher
     * (`packages/worker/src/enrich-source/twitter.ts`) when the tweet has
     * media. Same "server stores it, browser never fetches it directly"
     * pattern as `youtube`'s `thumbnailUrl`: `GET /api/preview-image`
     * (`packages/api/src/routes/preview-image.ts`) falls back to this field
     * when the link's own `imageUrl` is unset, so the web card renders it via
     * `PreviewCoverImage(linkId)` through the proxy — never a raw
     * `twimg.com` `<img src>` (privacy: no third-party call per row). A
     * text-only tweet (no media) omits this field entirely; the card then
     * shows no image. Not populated by the `silo ingest x` CLI's pre-
     * extracted payload today (its `mediaUrls` above is the equivalent for
     * that path) — only the live enricher sets it.
     */
    thumbnailUrl: z.string().min(1).max(2_000).optional(),
    /**
     * The author's own thread, set by the live enricher from FxTwitter's
     * `/2/thread/{id}` call: the posts before and after the saved post, in
     * thread order, all by the same author. Absent on captures made before
     * threads were stored and on posts that are not part of a thread.
     */
    threadBefore: z.array(twitterThreadPostSchema).max(THREAD_SIDE_MAX).optional(),
    threadAfter: z.array(twitterThreadPostSchema).max(THREAD_SIDE_MAX).optional(),
  })
  .strict();

/**
 * GitHub repository — stats from the unauthed `GET /repos/{owner}/{repo}`
 * REST call (source-data/rich-previews slice). All display data (repo
 * card stats), no internal-only fields. `description`/`language` are
 * optional: a repo can have an empty description, and `language` is `null`
 * upstream for a repo GitHub hasn't detected a primary language for (e.g. a
 * docs-only repo) — both are legitimately absent, not enrichment failures.
 * `languagePct` is likewise optional and deliberately NOT populated by the
 * enricher today (would need a second `/languages` call) — the field exists
 * so a later increment can add it without a schema/migration change.
 */
const githubSourceData = z
  .object({
    kind: z.literal('github'),
    stars: z.number().int().nonnegative().max(1_000_000_000),
    forks: z.number().int().nonnegative().max(1_000_000_000),
    issues: z.number().int().nonnegative().max(1_000_000_000),
    description: z.string().min(1).max(2000).optional(),
    language: z.string().min(1).max(100).optional(),
    languagePct: z.number().nonnegative().max(100).optional(),
  })
  .strict();

/**
 * YouTube video — the oEmbed-derived channel name plus a deterministic
 * thumbnail URL (`img.youtube.com/vi/{id}/hqdefault.jpg` — no fetch needed to
 * KNOW the url, only to later display it via the preview-image proxy).
 * Duration is deliberately DROPPED from this slice (plan 012): the YouTube
 * Data API requires a paid/quota-gated key that oEmbed doesn't need, so it's
 * out of scope here rather than half-built behind a key nobody has yet.
 */
const youtubeSourceData = z
  .object({
    kind: z.literal('youtube'),
    videoId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{11}$/)
      .optional(),
    channel: z.string().min(1).max(256),
    duration: z.number().int().nonnegative().max(100_000_000).optional(),
    views: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    publishedAt: z.string().max(64).optional(),
    keywords: z.array(z.string().max(500)).max(100).optional(),
    thumbnailUrl: z.string().min(1).max(2000),
  })
  .strict();

export const sourceDataSchema = z.discriminatedUnion('kind', [
  feedMediaSourceData,
  linkSourceData,
  hackerNewsSourceData,
  twitterSourceData,
  githubSourceData,
  youtubeSourceData,
]);

export type SourceData = z.infer<typeof sourceDataSchema>;

/** Drop invalid optional publisher URLs before the strict storage boundary. */
export function parseFeedMediaSourceData(
  value: Extract<SourceData, { kind: 'feed_media' }>,
): Extract<SourceData, { kind: 'feed_media' }> {
  const { imageUrl: _image, enclosureUrl: _enclosure, contentBaseUrl: _base, ...required } = value;
  const urls = Object.fromEntries(
    (['imageUrl', 'enclosureUrl', 'contentBaseUrl'] as const).flatMap((key) => {
      const parsed = feedUrlSchema.safeParse(value[key]);
      return parsed.success ? [[key, parsed.data]] : [];
    }),
  );
  return feedMediaSourceData.parse({ ...required, ...urls });
}
