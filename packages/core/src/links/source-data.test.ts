import { describe, expect, it } from 'vitest';
import { sourceDataSchema } from './source-data.js';

describe('sourceDataSchema', () => {
  describe('happy path', () => {
    it('parses a valid base link payload', () => {
      const result = sourceDataSchema.safeParse({ kind: 'link' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ kind: 'link' });
      }
    });

    it('parses a valid Hacker News payload', () => {
      const payload = { kind: 'hacker_news', points: 250, comments: 84, author: 'pg' };
      const result = sourceDataSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(payload);
      }
    });

    it('parses a valid Twitter payload (minimal required fields)', () => {
      const payload = {
        kind: 'twitter',
        text: 'hello world',
        authorHandle: 'jack',
        authorName: 'Jack',
        likes: 42,
        reposts: 5,
        replies: 3,
        quotes: 1,
        bookmarks: 7,
      };
      const result = sourceDataSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(payload);
      }
    });

    it('parses a full Field-Theory-shaped Twitter payload (all optional fields present)', () => {
      const payload = {
        kind: 'twitter',
        text: 'Check out https://example.com/tool — big update today',
        authorHandle: 'alice_dev',
        authorName: 'Alice Developer',
        authorAvatarUrl: 'https://pbs.twimg.com/profile_images/123/avatar.jpg',
        likes: 120,
        reposts: 15,
        replies: 8,
        quotes: 2,
        bookmarks: 34,
        postedAt: 'Mon Jul 06 14:25:00 +0000 2026',
        language: 'en',
        possiblySensitive: false,
        mediaUrls: ['https://pbs.twimg.com/media/abc123.jpg'],
        externalLinks: ['https://example.com/tool'],
      };
      const result = sourceDataSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(payload);
      }
    });

    it('allows zero counts (nonnegative, not strictly positive)', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'hacker_news',
        points: 0,
        comments: 0,
        author: 'nobody',
      });
      expect(result.success).toBe(true);
    });

    it('parses a valid GitHub payload with all optional fields', () => {
      const payload = {
        kind: 'github',
        stars: 12345,
        forks: 678,
        issues: 90,
        description: 'The React Framework',
        language: 'JavaScript',
        languagePct: 87.5,
      };
      const result = sourceDataSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(payload);
      }
    });

    it('parses a valid GitHub payload with only the required fields', () => {
      const payload = { kind: 'github', stars: 0, forks: 0, issues: 0 };
      const result = sourceDataSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(payload);
      }
    });

    it('parses a valid YouTube payload', () => {
      const payload = {
        kind: 'youtube',
        channel: 'Rick Astley',
        thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      };
      const result = sourceDataSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(payload);
      }
    });
  });

  describe('rejection — wrong shape / unknown / missing discriminant', () => {
    it('rejects a Hacker News payload missing required fields', () => {
      const result = sourceDataSchema.safeParse({ kind: 'hacker_news', points: 10 });
      expect(result.success).toBe(false);
    });

    it('rejects a Twitter payload with Hacker News fields (wrong shape for its kind)', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'twitter',
        points: 10,
        comments: 2,
        author: 'x',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a Twitter payload missing required fields', () => {
      const result = sourceDataSchema.safeParse({ kind: 'twitter', text: 'hi' });
      expect(result.success).toBe(false);
    });

    it('rejects an unknown source kind', () => {
      const result = sourceDataSchema.safeParse({ kind: 'reddit', author: 'x' });
      expect(result.success).toBe(false);
    });

    it('rejects a payload with no discriminant at all', () => {
      const result = sourceDataSchema.safeParse({ points: 10, comments: 2, author: 'x' });
      expect(result.success).toBe(false);
    });

    it('rejects an empty object', () => {
      const result = sourceDataSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('adversarial', () => {
    it('rejects extra unexpected fields (strict, not stripped)', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'link',
        unexpectedField: 'should not be here',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a Hacker News payload with an extra unexpected field', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'hacker_news',
        points: 1,
        comments: 1,
        author: 'x',
        extra: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects null', () => {
      const result = sourceDataSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it('rejects undefined', () => {
      const result = sourceDataSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });

    it('rejects a bare string', () => {
      const result = sourceDataSchema.safeParse('link');
      expect(result.success).toBe(false);
    });

    it('rejects a bare array', () => {
      const result = sourceDataSchema.safeParse([{ kind: 'link' }]);
      expect(result.success).toBe(false);
    });

    it('rejects wrong types for known fields (string instead of number)', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'hacker_news',
        points: '250',
        comments: 84,
        author: 'pg',
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative counts', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'twitter',
        text: 'hi',
        authorHandle: 'x',
        authorName: 'X',
        likes: -1,
        reposts: 0,
        replies: 0,
        quotes: 0,
        bookmarks: 0,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a non-integer count', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'hacker_news',
        points: 1.5,
        comments: 0,
        author: 'x',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an empty-string authorHandle', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'twitter',
        text: 'hi',
        authorHandle: '',
        authorName: 'X',
        likes: 1,
        reposts: 0,
        replies: 1,
        quotes: 0,
        bookmarks: 0,
      });
      expect(result.success).toBe(false);
    });

    it('rejects an oversized twitter text (>4000 chars) — no unbounded jsonb bloat', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'twitter',
        text: 'a'.repeat(4_001),
        authorHandle: 'x',
        authorName: 'X',
        likes: 1,
        reposts: 0,
        replies: 1,
        quotes: 0,
        bookmarks: 0,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a twitter language code that is not exactly 2 letters', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'twitter',
        text: 'hi',
        authorHandle: 'x',
        authorName: 'X',
        likes: 1,
        reposts: 0,
        replies: 1,
        quotes: 0,
        bookmarks: 0,
        language: 'eng',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an oversized twitter mediaUrls array (>64 entries) — bounded external jsonb', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'twitter',
        text: 'hi',
        authorHandle: 'x',
        authorName: 'X',
        likes: 1,
        reposts: 0,
        replies: 1,
        quotes: 0,
        bookmarks: 0,
        mediaUrls: Array.from({ length: 65 }, (_, i) => `https://pbs.twimg.com/${i}.jpg`),
      });
      expect(result.success).toBe(false);
    });

    it('rejects a twitter payload with the old-shape "author" field (removed, not renamed-and-kept)', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'twitter',
        text: 'hi',
        authorHandle: 'x',
        authorName: 'X',
        author: 'x',
        likes: 1,
        reposts: 0,
        replies: 1,
        quotes: 0,
        bookmarks: 0,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
    });

    it('rejects a numeric kind', () => {
      const result = sourceDataSchema.safeParse({ kind: 1 });
      expect(result.success).toBe(false);
    });

    it('rejects (not strips) unknown fields via .strict() — unrecognized_keys', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'hacker_news',
        points: 1,
        comments: 1,
        author: 'a',
        surpriseField: 'nope',
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.some((issue) => issue.code === 'unrecognized_keys')).toBe(true);
    });

    it('rejects an oversized author string (>256 chars) — no unbounded jsonb bloat', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'hacker_news',
        points: 1,
        comments: 1,
        author: 'a'.repeat(257),
      });
      expect(result.success).toBe(false);
    });

    it('rejects a GitHub payload with an extra unexpected field', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'github',
        stars: 1,
        forks: 1,
        issues: 1,
        extra: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a GitHub payload missing required fields', () => {
      const result = sourceDataSchema.safeParse({ kind: 'github', stars: 1 });
      expect(result.success).toBe(false);
    });

    it('rejects negative GitHub stats', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'github',
        stars: -1,
        forks: 0,
        issues: 0,
      });
      expect(result.success).toBe(false);
    });

    it('rejects an empty GitHub description (min 1)', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'github',
        stars: 1,
        forks: 1,
        issues: 1,
        description: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects a GitHub languagePct over 100', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'github',
        stars: 1,
        forks: 1,
        issues: 1,
        languagePct: 101,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a YouTube payload with an extra unexpected field', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'youtube',
        channel: 'x',
        thumbnailUrl: 'https://img.youtube.com/vi/x/hqdefault.jpg',
        extra: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects a YouTube payload missing required fields', () => {
      const result = sourceDataSchema.safeParse({ kind: 'youtube', channel: 'x' });
      expect(result.success).toBe(false);
    });

    it('rejects an empty YouTube channel string', () => {
      const result = sourceDataSchema.safeParse({
        kind: 'youtube',
        channel: '',
        thumbnailUrl: 'https://img.youtube.com/vi/x/hqdefault.jpg',
      });
      expect(result.success).toBe(false);
    });
  });
});
