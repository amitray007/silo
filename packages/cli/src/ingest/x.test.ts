import { describe, expect, it } from 'vitest';
import type { FieldTheoryBookmark } from './fieldtheory.js';
import { mapBookmarkToIngest } from './x.js';

const syntheticBookmark: FieldTheoryBookmark = {
  id: '1000000000000000001',
  url: 'https://x.com/alice_dev/status/1000000000000000001',
  text: '✨ Free animated component library',
  authorHandle: 'alice_dev',
  authorName: 'Alice Developer',
  authorProfileImageUrl:
    'https://pbs.twimg.com/profile_images/000000000000000001/synthetic_normal.jpeg',
  postedAt: 'Mon Jul 06 14:25:00 +0000 2026',
  language: 'en',
  possiblySensitive: false,
  engagement: { likeCount: 375, repostCount: 45, replyCount: 8, quoteCount: 0, bookmarkCount: 429 },
  media: ['https://pbs.twimg.com/amplify_video_thumb/1000000000000000011/img/synthetic_thumb1.jpg'],
  links: ['http://www.example.com/tool'],
};

describe('mapBookmarkToIngest', () => {
  it('maps a Field Theory bookmark to the ingest payload per the locked schema mapping', () => {
    const result = mapBookmarkToIngest(syntheticBookmark);

    expect(result).not.toBeNull();
    expect(result?.url).toBe(syntheticBookmark.url);
    expect(result?.sourceKind).toBe('twitter');
    // The note must NOT be auto-filled from the tweet text — it is the user's
    // own free-form note (¶), left empty on ingest. The tweet text is carried
    // in sourceData.text (asserted below). Regression guard for the bug where
    // the mapper copied `text` into `note`, duplicating content.
    expect(result?.note).toBeUndefined();

    const sourceData = result?.sourceData;
    expect(sourceData?.kind).toBe('twitter');
    if (sourceData?.kind !== 'twitter') throw new Error('expected twitter sourceData');
    expect(sourceData.text).toBe(syntheticBookmark.text);
    expect(sourceData.authorHandle).toBe('alice_dev');
    expect(sourceData.authorName).toBe('Alice Developer');
    expect(sourceData.likes).toBe(375);
    expect(sourceData.reposts).toBe(45);
    expect(sourceData.replies).toBe(8);
    expect(sourceData.quotes).toBe(0);
    expect(sourceData.bookmarks).toBe(429);
    expect(sourceData.postedAt).toBe('Mon Jul 06 14:25:00 +0000 2026');
    expect(sourceData.language).toBe('en');
    expect(sourceData.possiblySensitive).toBe(false);
    expect(sourceData.mediaUrls).toEqual([
      'https://pbs.twimg.com/amplify_video_thumb/1000000000000000011/img/synthetic_thumb1.jpg',
    ]);
    expect(sourceData.externalLinks).toEqual(['http://www.example.com/tool']);
  });

  it('defaults missing engagement counts to 0 (all counts are required, non-optional fields on the variant)', () => {
    const bookmark: FieldTheoryBookmark = {
      id: '1',
      url: 'https://x.com/a/status/1',
      text: 'hi',
      authorHandle: 'a',
      authorName: 'A',
    };

    const result = mapBookmarkToIngest(bookmark);
    const sourceData = result?.sourceData;
    if (sourceData?.kind !== 'twitter') throw new Error('expected twitter sourceData');
    expect(sourceData.likes).toBe(0);
    expect(sourceData.reposts).toBe(0);
    expect(sourceData.replies).toBe(0);
    expect(sourceData.quotes).toBe(0);
    expect(sourceData.bookmarks).toBe(0);
  });

  it('drops mediaUrls/externalLinks entirely when absent rather than sending empty arrays', () => {
    const bookmark: FieldTheoryBookmark = {
      id: '1',
      url: 'https://x.com/a/status/1',
      text: 'hi',
      authorHandle: 'a',
      authorName: 'A',
    };
    const result = mapBookmarkToIngest(bookmark);
    const sourceData = result?.sourceData;
    if (sourceData?.kind !== 'twitter') throw new Error('expected twitter sourceData');
    expect(sourceData.mediaUrls).toBeUndefined();
    expect(sourceData.externalLinks).toBeUndefined();
  });

  it('truncates text over the 4000-char bound rather than rejecting the bookmark', () => {
    const bookmark: FieldTheoryBookmark = {
      id: '1',
      url: 'https://x.com/a/status/1',
      text: 'x'.repeat(5000),
      authorHandle: 'a',
      authorName: 'A',
    };
    const result = mapBookmarkToIngest(bookmark);
    const sourceData = result?.sourceData;
    if (sourceData?.kind !== 'twitter') throw new Error('expected twitter sourceData');
    expect(sourceData.text.length).toBe(4000);
  });

  it('drops a language code that is not exactly 2 chars rather than sending an invalid one', () => {
    const bookmark: FieldTheoryBookmark = {
      id: '1',
      url: 'https://x.com/a/status/1',
      text: 'hi',
      authorHandle: 'a',
      authorName: 'A',
      language: 'eng',
    };
    const result = mapBookmarkToIngest(bookmark);
    const sourceData = result?.sourceData;
    if (sourceData?.kind !== 'twitter') throw new Error('expected twitter sourceData');
    expect(sourceData.language).toBeUndefined();
  });

  it('clamps oversized media/external-link arrays to 64 items and 2000 chars each', () => {
    const bookmark: FieldTheoryBookmark = {
      id: '1',
      url: 'https://x.com/a/status/1',
      text: 'hi',
      authorHandle: 'a',
      authorName: 'A',
      media: Array.from({ length: 100 }, (_, i) => `https://twimg.com/${i}`),
      links: [`https://example.com/${'x'.repeat(3000)}`],
    };
    const result = mapBookmarkToIngest(bookmark);
    const sourceData = result?.sourceData;
    if (sourceData?.kind !== 'twitter') throw new Error('expected twitter sourceData');
    expect(sourceData.mediaUrls?.length).toBe(64);
    expect(sourceData.externalLinks?.[0]?.length).toBe(2000);
  });

  it('returns null when a required field is empty (cannot map)', () => {
    const bookmark: FieldTheoryBookmark = {
      id: '1',
      url: 'https://x.com/a/status/1',
      text: '',
      authorHandle: 'a',
      authorName: 'A',
    };
    expect(mapBookmarkToIngest(bookmark)).toBeNull();
  });
});
