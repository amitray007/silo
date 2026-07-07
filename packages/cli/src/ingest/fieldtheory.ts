import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * A single bookmark line from Field Theory's `bookmarks.jsonl`, per
 * `docs/plans/refs/fieldtheory-bookmarks-schema.md` (captured from a real
 * `ft sync`, 1381 bookmarks — ground truth, not guessed). Only the fields
 * `mapBookmarkToIngest` (`x.ts`) actually reads are declared; the real file
 * has more (`author`, `tags`, `ingestedVia`, `sortIndex`, `conversationId`)
 * that this ingester doesn't use.
 */
export type FieldTheoryBookmark = {
  id: string;
  url: string;
  text: string;
  authorHandle: string;
  authorName: string;
  authorProfileImageUrl?: string;
  postedAt?: string;
  language?: string;
  possiblySensitive?: boolean;
  engagement?: {
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
  };
  media?: string[];
  links?: string[];
};

/** `~/.fieldtheory/bookmarks/bookmarks.jsonl` (or `$FT_DATA_DIR/bookmarks/bookmarks.jsonl`) — per the plan, `$FT_DATA_DIR` overrides the base dir Field Theory writes under. */
export function bookmarksFilePath(): string {
  const base = process.env.FT_DATA_DIR;
  const ftDir = base && base.length > 0 ? base : join(homedir(), '.fieldtheory');
  return join(ftDir, 'bookmarks', 'bookmarks.jsonl');
}

/** Thrown when the Field Theory export file doesn't exist — the ingest command turns this into the plan's required clear message ("run `ft sync` first") rather than a raw ENOENT. */
export class BookmarksFileNotFoundError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`No Field Theory bookmarks found at ${path} — run \`ft sync\` first.`);
    this.name = 'BookmarksFileNotFoundError';
    this.path = path;
  }
}

/** A line that didn't parse as JSON, or parsed but is missing a required field (`id`/`url`/`text`/`authorHandle`/`authorName`) — the reader SKIPS it (per the plan: "skip a bookmark that can't map rather than crashing the whole run") and reports it via `onSkip`. */
export type SkipReason = { line: number; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Parses `parsed.engagement` (if it's an object) into the bookmark's `engagement` field, keeping only the numeric counts that are actually present — mirrors the permissiveness of the rest of this parser (an engagement object missing a count is fine; a whole-object type mismatch just yields `undefined`). Factored out of `parseBookmarkLine` to keep that function's cognitive complexity under the lint's ceiling. */
function parseEngagement(value: unknown): FieldTheoryBookmark['engagement'] {
  if (!isRecord(value)) return undefined;
  const engagement: NonNullable<FieldTheoryBookmark['engagement']> = {};
  if (typeof value.likeCount === 'number') engagement.likeCount = value.likeCount;
  if (typeof value.repostCount === 'number') engagement.repostCount = value.repostCount;
  if (typeof value.replyCount === 'number') engagement.replyCount = value.replyCount;
  if (typeof value.quoteCount === 'number') engagement.quoteCount = value.quoteCount;
  if (typeof value.bookmarkCount === 'number') engagement.bookmarkCount = value.bookmarkCount;
  return engagement;
}

/** Applies every OPTIONAL field from a parsed JSON record onto `bookmark`, mutating it in place — split out of `parseBookmarkLine` (which handles the REQUIRED fields + JSON/shape validation) purely to keep that function's cognitive complexity under the lint's ceiling; the two together are `parseBookmarkLine`'s full behavior. */
function applyOptionalFields(bookmark: FieldTheoryBookmark, parsed: Record<string, unknown>): void {
  if (typeof parsed.authorProfileImageUrl === 'string') {
    bookmark.authorProfileImageUrl = parsed.authorProfileImageUrl;
  }
  if (typeof parsed.postedAt === 'string') bookmark.postedAt = parsed.postedAt;
  if (typeof parsed.language === 'string') bookmark.language = parsed.language;
  if (typeof parsed.possiblySensitive === 'boolean') {
    bookmark.possiblySensitive = parsed.possiblySensitive;
  }
  const engagement = parseEngagement(parsed.engagement);
  if (engagement) bookmark.engagement = engagement;
  if (Array.isArray(parsed.media)) {
    bookmark.media = parsed.media.filter((m): m is string => typeof m === 'string');
  }
  if (Array.isArray(parsed.links)) {
    bookmark.links = parsed.links.filter((l): l is string => typeof l === 'string');
  }
}

/** Parses one JSONL line into a `FieldTheoryBookmark`, or returns `null` if it's malformed/missing a required field. Deliberately permissive about EXTRA fields (the real file has many more than this type declares) and about optional fields (`engagement`/`media`/`links` may be absent) — only the fields the mapping truly needs are required. */
function parseBookmarkLine(line: string): FieldTheoryBookmark | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const { id, url, text, authorHandle, authorName } = parsed;
  if (
    typeof id !== 'string' ||
    typeof url !== 'string' ||
    typeof text !== 'string' ||
    typeof authorHandle !== 'string' ||
    typeof authorName !== 'string'
  ) {
    return null;
  }

  const bookmark: FieldTheoryBookmark = { id, url, text, authorHandle, authorName };
  applyOptionalFields(bookmark, parsed);
  return bookmark;
}

/** `true` if the Field Theory bookmarks file exists and is readable. */
export async function bookmarksFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Streams `bookmarks.jsonl` line-by-line (the plan: "the file can be MBs /
 * 1000s of lines" — 1381 in the real file), yielding parsed bookmarks and
 * reporting unparseable lines via `onSkip` rather than crashing the run.
 * Streaming (not `readFile` + `JSON.parse` per line after a full read) keeps
 * memory flat regardless of file size.
 */
export async function* readFieldTheoryBookmarks(
  path: string,
  onSkip?: (skip: SkipReason) => void,
): AsyncGenerator<FieldTheoryBookmark> {
  if (!(await bookmarksFileExists(path))) {
    throw new BookmarksFileNotFoundError(path);
  }

  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const raw of rl) {
    lineNumber += 1;
    const trimmed = raw.trim();
    if (trimmed === '') continue;

    const bookmark = parseBookmarkLine(trimmed);
    if (!bookmark) {
      onSkip?.({ line: lineNumber, reason: 'malformed or missing a required field' });
      continue;
    }
    yield bookmark;
  }
}
