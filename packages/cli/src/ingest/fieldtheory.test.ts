import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BookmarksFileNotFoundError,
  bookmarksFileExists,
  bookmarksFilePath,
  readFieldTheoryBookmarks,
} from './fieldtheory.js';

const FIXTURES_DIR = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const REAL_SAMPLE = `${FIXTURES_DIR}bookmarks-sample.jsonl`;
const WITH_MALFORMED = `${FIXTURES_DIR}bookmarks-with-malformed.jsonl`;

describe('bookmarksFilePath', () => {
  const originalFtDataDir = process.env.FT_DATA_DIR;

  afterEach(() => {
    if (originalFtDataDir === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = originalFtDataDir;
  });

  it('defaults to ~/.fieldtheory/bookmarks/bookmarks.jsonl', () => {
    delete process.env.FT_DATA_DIR;
    expect(bookmarksFilePath()).toMatch(/\.fieldtheory\/bookmarks\/bookmarks\.jsonl$/);
  });

  it('honors $FT_DATA_DIR when set', () => {
    process.env.FT_DATA_DIR = '/custom/ft';
    expect(bookmarksFilePath()).toBe('/custom/ft/bookmarks/bookmarks.jsonl');
  });
});

describe('bookmarksFileExists', () => {
  it('is true for a real file', async () => {
    expect(await bookmarksFileExists(REAL_SAMPLE)).toBe(true);
  });

  it('is false for a missing file', async () => {
    expect(await bookmarksFileExists('/no/such/file.jsonl')).toBe(false);
  });
});

describe('readFieldTheoryBookmarks', () => {
  it('throws BookmarksFileNotFoundError with a clear "run ft sync" message when the file is missing', async () => {
    const iterate = async () => {
      const results = [];
      for await (const b of readFieldTheoryBookmarks('/no/such/file.jsonl')) results.push(b);
      return results;
    };

    await expect(iterate()).rejects.toBeInstanceOf(BookmarksFileNotFoundError);
    await expect(iterate()).rejects.toThrow(/run `ft sync` first/);
  });

  it('parses Field Theory bookmark lines (synthetic fixture matching the ~/.fieldtheory export shape)', async () => {
    const bookmarks = [];
    for await (const b of readFieldTheoryBookmarks(REAL_SAMPLE)) bookmarks.push(b);

    expect(bookmarks.length).toBe(3);
    const first = bookmarks[0];
    expect(first?.id).toBe('1000000000000000001');
    expect(first?.url).toBe('https://x.com/alice_dev/status/1000000000000000001');
    expect(first?.authorHandle).toBe('alice_dev');
    expect(first?.authorName).toBe('Alice Developer');
    expect(first?.engagement?.likeCount).toBe(375);
    expect(first?.engagement?.bookmarkCount).toBe(429);
    expect(first?.media).toContain(
      'https://pbs.twimg.com/amplify_video_thumb/1000000000000000011/img/synthetic_thumb1.jpg',
    );
    expect(first?.links).toEqual(['http://www.example.com/tool']);
    expect(first?.language).toBe('en');
    expect(first?.possiblySensitive).toBe(false);
  });

  it('skips malformed/blank/missing-field lines and reports them via onSkip, without crashing the run', async () => {
    const skips: number[] = [];
    const bookmarks = [];
    for await (const b of readFieldTheoryBookmarks(WITH_MALFORMED, (skip) =>
      skips.push(skip.line),
    )) {
      bookmarks.push(b);
    }

    // 3 real lines parse; the malformed-JSON line and the missing-fields
    // line are skipped; the blank line is silently ignored (not a "skip"
    // worth reporting — it's not malformed data, just whitespace).
    expect(bookmarks.length).toBe(3);
    expect(skips.length).toBe(2);
  });
});
