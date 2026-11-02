import {
  db,
  HIGHLIGHT_COLORS,
  type HighlightColor,
  highlights,
  links,
  linkTags,
  tags,
} from '@silo/db';
import { asc, desc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { Tx } from './executor.js';
import {
  collapseWhitespace,
  contextAfter,
  contextBefore,
  HIGHLIGHT_CONTEXT_MAX,
} from './highlight-text.js';

export { HIGHLIGHT_CONTEXT_MAX };

import { assertLibraryWrite } from './library-write.js';
import { whereLibrary, whereLiveAnywhere } from './live.js';
import { decodeReaderCursor, effectiveLimit, encodeReaderCursor } from './pagination.js';
import { normalizeTagKey } from './tag-key.js';

export { HIGHLIGHT_COLORS, type HighlightColor };

/** Largest quote, note and context sizes. The table checks the same bounds. */
export const HIGHLIGHT_QUOTE_MAX = 5000;
export const HIGHLIGHT_NOTE_MAX = 10000;
/** The largest value of a Postgres `integer` column; offsets stay within it. */
export const HIGHLIGHT_OFFSET_MAX = 2_147_483_647;
/** The most highlights one imported link keeps. */
export const HIGHLIGHT_IMPORT_MAX = 1000;

/** One highlighted passage of a link's article. */
export type Highlight = {
  id: string;
  linkId: string;
  /** The highlighted text, whitespace collapsed. */
  quote: string;
  /** Up to 64 characters of the text just before the quote. */
  prefix: string;
  /** Up to 64 characters of the text just after the quote. */
  suffix: string;
  /** Hints into the article's normalised text. `null` when the writer had none. */
  startOffset: number | null;
  endOffset: number | null;
  color: HighlightColor;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Thrown for a highlight input that breaks a rule (bounds, quote not found). */
export class InvalidHighlightError extends Error {
  readonly code = 'invalid_highlight';
  constructor(message: string) {
    super(`invalid_highlight: ${message}`);
    this.name = 'InvalidHighlightError';
  }
}

export type AddHighlightInput = {
  quote: string;
  /**
   * Context and offsets come from a writer that knows where the quote sits (the
   * web reader). When neither `prefix` nor `suffix` is given, the quote is
   * found in the link's saved text and the context is filled from there.
   */
  prefix?: string | undefined;
  suffix?: string | undefined;
  startOffset?: number | null | undefined;
  endOffset?: number | null | undefined;
  /** Picks the nth match of the quote in the saved text (1 is the first). Quote-only writes. */
  occurrence?: number | undefined;
  color?: HighlightColor | undefined;
  note?: string | null | undefined;
};

export type EditHighlightInput = {
  color?: HighlightColor | undefined;
  /** `null` or an empty string clears the note. */
  note?: string | null | undefined;
};

const columns = {
  id: highlights.id,
  linkId: highlights.linkId,
  quote: highlights.quote,
  prefix: highlights.prefix,
  suffix: highlights.suffix,
  startOffset: highlights.startOffset,
  endOffset: highlights.endOffset,
  color: highlights.color,
  note: highlights.note,
  createdAt: highlights.createdAt,
  updatedAt: highlights.updatedAt,
};

type Row = Omit<Highlight, 'color'> & { color: string };

function toHighlight(row: Row): Highlight {
  return { ...row, color: row.color as HighlightColor };
}

const byPosition = [
  sql`${highlights.startOffset} asc nulls last`,
  asc(highlights.createdAt),
  asc(highlights.id),
];

/**
 * Find the nth (1-based) non-overlapping match of `quote` in `text`, after both
 * collapse whitespace. Returns the match start in the collapsed text, or the
 * number of matches found when there are fewer than `occurrence`.
 */
function findQuote(
  collapsed: string,
  quote: string,
  occurrence: number,
): { start: number } | { found: number } {
  let from = 0;
  let found = 0;
  for (;;) {
    const at = collapsed.indexOf(quote, from);
    if (at < 0) return { found };
    found += 1;
    if (found === occurrence) return { start: at };
    from = at + quote.length;
  }
}

/** Reject a quote, note or context that breaks the table bounds, with a clear message. */
function assertBounds(input: {
  quote: string;
  prefix: string;
  suffix: string;
  note: string | null;
}) {
  if (input.quote.length < 1 || input.quote.length > HIGHLIGHT_QUOTE_MAX) {
    throw new InvalidHighlightError(`quote must be 1 to ${HIGHLIGHT_QUOTE_MAX} characters.`);
  }
  if (input.prefix.length > HIGHLIGHT_CONTEXT_MAX || input.suffix.length > HIGHLIGHT_CONTEXT_MAX) {
    throw new InvalidHighlightError(
      `prefix and suffix are at most ${HIGHLIGHT_CONTEXT_MAX} characters.`,
    );
  }
  if (input.note !== null && input.note.length > HIGHLIGHT_NOTE_MAX) {
    throw new InvalidHighlightError(`note must be at most ${HIGHLIGHT_NOTE_MAX} characters.`);
  }
  assertNoNul({ quote: input.quote, prefix: input.prefix, suffix: input.suffix, note: input.note });
}

/** Postgres text cannot hold a NUL byte; reject it up front instead of failing at insert. */
function assertNoNul(fields: Record<string, string | null | undefined>) {
  for (const [name, value] of Object.entries(fields)) {
    if (value?.includes('\u0000')) {
      throw new InvalidHighlightError(`${name} must not contain a NUL character.`);
    }
  }
}

function assertColor(color: string): asserts color is HighlightColor {
  if (!(HIGHLIGHT_COLORS as ReadonlyArray<string>).includes(color)) {
    throw new InvalidHighlightError(`color must be one of ${HIGHLIGHT_COLORS.join(', ')}.`);
  }
}

function assertOffsets(start: number | null, end: number | null) {
  if ((start === null) !== (end === null)) {
    throw new InvalidHighlightError('startOffset and endOffset go together.');
  }
  if (start !== null && end !== null) {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end <= start ||
      end > HIGHLIGHT_OFFSET_MAX
    ) {
      throw new InvalidHighlightError(
        `offsets must be integers with 0 <= start < end <= ${HIGHLIGHT_OFFSET_MAX}.`,
      );
    }
  }
}

/** The highlights of one link, ordered by start offset then creation time. Reads no link state. */
export async function listHighlights(linkId: string): Promise<Highlight[]> {
  const rows = await db
    .select(columns)
    .from(highlights)
    .where(eq(highlights.linkId, linkId))
    .orderBy(...byPosition);
  return rows.map(toHighlight);
}

/** The highlights of several links in one query, grouped by link id (batch reads). */
export async function listHighlightsForLinks(
  linkIds: ReadonlyArray<string>,
): Promise<Map<string, Highlight[]>> {
  const grouped = new Map<string, Highlight[]>();
  const unique = [...new Set(linkIds)];
  if (unique.length === 0) return grouped;
  const rows = await db
    .select(columns)
    .from(highlights)
    .where(inArray(highlights.linkId, unique))
    .orderBy(...byPosition);
  for (const row of rows) {
    const list = grouped.get(row.linkId) ?? [];
    list.push(toHighlight(row));
    grouped.set(row.linkId, list);
  }
  return grouped;
}

/**
 * Quote-only write (an agent): find the quote in the link's saved text and
 * take the prefix and suffix from around the match. Whitespace is collapsed on
 * both sides, so the stored quote matches the reader's own text walk.
 */
function matchQuote(
  text: string | null,
  input: { quote: string; occurrence?: number | undefined },
): { quote: string; prefix: string; suffix: string } {
  const quote = collapseWhitespace(input.quote);
  if (quote.length < 1) throw new InvalidHighlightError('quote must not be blank.');
  if (quote.length > HIGHLIGHT_QUOTE_MAX) {
    throw new InvalidHighlightError(`quote must be 1 to ${HIGHLIGHT_QUOTE_MAX} characters.`);
  }
  const occurrence = input.occurrence ?? 1;
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new InvalidHighlightError('occurrence must be a whole number from 1.');
  }
  if (!text) {
    throw new InvalidHighlightError(
      'this link has no saved text to match the quote against. Capture finished? Try get_link.',
    );
  }
  const collapsed = collapseWhitespace(text);
  const match = findQuote(collapsed, quote, occurrence);
  if ('found' in match) {
    throw new InvalidHighlightError(
      match.found === 0
        ? 'the quote is not in the saved text of this link. Copy it exactly (case and punctuation count) from get_link extractedText.'
        : `the quote appears ${match.found} time(s) in the saved text, so occurrence ${occurrence} does not exist.`,
    );
  }
  const end = match.start + quote.length;
  return {
    quote,
    prefix: contextBefore(collapsed, match.start),
    suffix: contextAfter(collapsed, end),
  };
}

/**
 * Add a highlight to a live library link. Returns the saved highlight, or
 * `null` when the link is unknown or trashed. Throws `InvalidHighlightError`
 * for a broken bound, an unknown colour, or a quote that is not in the link's
 * saved text (quote-only writes), and `FeedPostNotEditableError` for a feed
 * post. Overlapping highlights are allowed: each row is an independent range.
 */
export async function addHighlight(
  linkId: string,
  input: AddHighlightInput,
): Promise<Highlight | null> {
  const color = input.color ?? 'yellow';
  assertColor(color);
  const note = input.note == null || input.note === '' ? null : input.note;
  const startOffset = input.startOffset ?? null;
  const endOffset = input.endOffset ?? null;
  assertOffsets(startOffset, endOffset);

  await assertLibraryWrite(linkId);
  // Only a quote-only (agent) write needs the saved text; a web write sends its own context.
  const quoteOnly = input.prefix === undefined && input.suffix === undefined;
  const [live] = await db
    .select(quoteOnly ? { id: links.id, text: links.extractedText } : { id: links.id })
    .from(links)
    .where(whereLibrary(eq(links.id, linkId)));
  if (!live) return null;

  const context = quoteOnly
    ? matchQuote('text' in live ? live.text : null, input)
    : { quote: input.quote, prefix: input.prefix ?? '', suffix: input.suffix ?? '' };
  const { quote, prefix, suffix } = context;
  assertBounds({ quote, prefix, suffix, note });

  const [saved] = await db
    .insert(highlights)
    .values({ linkId, quote, prefix, suffix, startOffset, endOffset, color, note })
    .returning(columns);
  return saved ? toHighlight(saved) : null;
}

/** The link a highlight belongs to, when that link is not trashed. A feed post reaches `assertLibraryWrite`. */
async function liveLinkOf(id: string): Promise<string | null> {
  const [row] = await db
    .select({ linkId: highlights.linkId })
    .from(highlights)
    .innerJoin(links, eq(links.id, highlights.linkId))
    .where(whereLiveAnywhere(eq(highlights.id, id)));
  return row?.linkId ?? null;
}

/**
 * Change a highlight's colour and/or note. Returns the updated highlight, or
 * `null` when the highlight is unknown or its link is trashed. Throws
 * `InvalidHighlightError` for a bad colour or note, and
 * `FeedPostNotEditableError` for a feed post.
 */
export async function editHighlight(
  id: string,
  patch: EditHighlightInput,
): Promise<Highlight | null> {
  if (patch.color !== undefined) assertColor(patch.color);
  const note = patch.note === undefined ? undefined : patch.note === '' ? null : patch.note;
  if (note != null && note.length > HIGHLIGHT_NOTE_MAX) {
    throw new InvalidHighlightError(`note must be at most ${HIGHLIGHT_NOTE_MAX} characters.`);
  }
  assertNoNul({ note });
  const linkId = await liveLinkOf(id);
  if (!linkId) return null;
  await assertLibraryWrite(linkId);

  const set: { color?: HighlightColor; note?: string | null; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (patch.color !== undefined) set.color = patch.color;
  if (note !== undefined) set.note = note;
  const [updated] = await db
    .update(highlights)
    .set(set)
    .where(eq(highlights.id, id))
    .returning(columns);
  return updated ? toHighlight(updated) : null;
}

/** Delete a highlight. Returns `true` when it existed on a live library link. */
export async function deleteHighlight(id: string): Promise<boolean> {
  const linkId = await liveLinkOf(id);
  if (!linkId) return false;
  await assertLibraryWrite(linkId);
  const deleted = await db.delete(highlights).where(eq(highlights.id, id)).returning({
    id: highlights.id,
  });
  return deleted.length > 0;
}

/** Restore-merge helper: move every highlight of the merged-away link onto the surviving one. */
export async function moveHighlights(tx: Tx, fromLinkId: string, toLinkId: string): Promise<void> {
  await tx.update(highlights).set({ linkId: toLinkId }).where(eq(highlights.linkId, fromLinkId));
}

/** Export helper: every live library link's highlights in one query, grouped by link id. */
export async function listLibraryHighlightsByLink(): Promise<Map<string, Highlight[]>> {
  const rows = await db
    .select(columns)
    .from(highlights)
    .innerJoin(links, eq(links.id, highlights.linkId))
    .where(whereLibrary())
    .orderBy(...byPosition);
  const grouped = new Map<string, Highlight[]>();
  for (const row of rows) {
    const list = grouped.get(row.linkId) ?? [];
    list.push(toHighlight(row));
    grouped.set(row.linkId, list);
  }
  return grouped;
}

/** What an import did with one link's highlights. */
export type RestoreHighlightsResult = { restored: number; skipped: number; reason?: string };

/**
 * Import helper: write exported highlights onto a live library link with their
 * original timestamps. Never throws for a bad highlight: each one that breaks a
 * bound is counted in `skipped` with the first reason, and only the first
 * `HIGHLIGHT_IMPORT_MAX` are kept. A database failure still throws; the caller
 * reports it without failing the link.
 */
export async function restoreHighlights(
  linkId: string,
  saved: ReadonlyArray<Omit<Highlight, 'id' | 'linkId'> & { id?: string }>,
): Promise<RestoreHighlightsResult> {
  const [live] = await db
    .select({ id: links.id })
    .from(links)
    .where(whereLibrary(eq(links.id, linkId)));
  if (!live)
    return { restored: 0, skipped: saved.length, reason: 'the link is not a live library link' };
  let skipped = 0;
  let reason: string | undefined;
  const skip = (why: string) => {
    skipped += 1;
    reason ??= why;
  };
  const rows = [];
  for (const item of saved) {
    if (rows.length >= HIGHLIGHT_IMPORT_MAX) {
      skip(`only ${HIGHLIGHT_IMPORT_MAX} highlights are imported per link`);
      continue;
    }
    try {
      assertColor(item.color);
      assertBounds({ ...item, note: item.note });
      assertOffsets(item.startOffset, item.endOffset);
    } catch (error) {
      skip(error instanceof Error ? error.message : String(error));
      continue;
    }
    rows.push({
      linkId,
      quote: item.quote,
      prefix: item.prefix,
      suffix: item.suffix,
      startOffset: item.startOffset,
      endOffset: item.endOffset,
      color: item.color,
      note: item.note,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }
  // Importing the same file twice must not double the highlights.
  const existing = await db
    .select({ quote: highlights.quote, prefix: highlights.prefix, suffix: highlights.suffix })
    .from(highlights)
    .where(eq(highlights.linkId, linkId));
  const key = (row: { prefix: string; quote: string; suffix: string }) =>
    `${row.prefix}\u0000${row.quote}\u0000${row.suffix}`;
  const seen = new Set(existing.map(key));
  const fresh = rows.filter((row) => !seen.has(key(row)));
  if (fresh.length > 0) await db.insert(highlights).values(fresh);
  return reason === undefined
    ? { restored: fresh.length, skipped }
    : { restored: fresh.length, skipped, reason };
}

export type ListLibraryHighlightsInput = {
  query?: string | undefined;
  linkId?: string | undefined;
  tag?: string | undefined;
  hasNote?: boolean | undefined;
  color?: HighlightColor | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
};

export type LibraryHighlight = Pick<
  Highlight,
  'id' | 'quote' | 'note' | 'color' | 'createdAt' | 'updatedAt'
> & { link: { id: string; title: string | null; url: string } };

/** Search passages and notes on live library links, newest first, with bounded keyset pages. */
export async function listLibraryHighlights(
  input: ListLibraryHighlightsInput = {},
): Promise<{ highlights: LibraryHighlight[]; nextCursor?: string }> {
  const limit = effectiveLimit(input.limit);
  const cursor =
    input.cursor === undefined ? undefined : decodeReaderCursor(input.cursor, 'highlights');
  // LIKE metacharacters are literal user text, including the escape character itself.
  const pattern =
    input.query === undefined ? undefined : `%${input.query.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await db
    .select({
      id: highlights.id,
      quote: highlights.quote,
      note: highlights.note,
      color: highlights.color,
      createdAt: highlights.createdAt,
      updatedAt: highlights.updatedAt,
      link: { id: links.id, title: links.title, url: links.url },
      timestamp: sql<string>`${highlights.createdAt}::text`,
    })
    .from(highlights)
    .innerJoin(links, eq(links.id, highlights.linkId))
    .where(
      whereLibrary(
        input.linkId === undefined ? undefined : eq(links.id, input.linkId),
        input.color === undefined ? undefined : eq(highlights.color, input.color),
        input.hasNote ? isNotNull(highlights.note) : undefined,
        pattern === undefined
          ? undefined
          : or(ilike(highlights.quote, pattern), ilike(highlights.note, pattern)),
        input.tag === undefined
          ? undefined
          : sql`exists (
        select 1 from ${linkTags} inner join ${tags} on ${tags.id} = ${linkTags.tagId}
        where ${linkTags.linkId} = ${links.id} and ${tags.normalizedKey} = ${normalizeTagKey(input.tag)}
      )`,
        cursor
          ? sql`(${highlights.createdAt}, ${highlights.id}) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(highlights.createdAt), desc(highlights.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    highlights: page.map(({ timestamp: _timestamp, ...row }) => ({
      ...row,
      color: row.color as HighlightColor,
    })),
    ...(rows.length > limit && last
      ? { nextCursor: encodeReaderCursor('highlights', last.timestamp, last.id) }
      : {}),
  };
}
