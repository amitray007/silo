import { describe, expect, it } from 'vitest';
import { detectSource } from './detect-source.js';

describe('detectSource', () => {
  describe('hacker_news', () => {
    it('detects a canonical HN item url', () => {
      expect(detectSource('https://news.ycombinator.com/item?id=12345')).toEqual({
        kind: 'hacker_news',
        itemId: 12345,
      });
    });

    it('detects with www. and extra query params', () => {
      expect(detectSource('https://www.news.ycombinator.com/item?id=42&p=2#comments')).toEqual({
        kind: 'hacker_news',
        itemId: 42,
      });
    });

    it('detects with http scheme', () => {
      expect(detectSource('http://news.ycombinator.com/item?id=1')).toEqual({
        kind: 'hacker_news',
        itemId: 1,
      });
    });

    it('does not match the HN front page', () => {
      expect(detectSource('https://news.ycombinator.com/')).toEqual({ kind: 'link' });
    });

    it('does not match /item without an id', () => {
      expect(detectSource('https://news.ycombinator.com/item')).toEqual({ kind: 'link' });
    });

    it('does not match a non-numeric id', () => {
      expect(detectSource('https://news.ycombinator.com/item?id=abc')).toEqual({ kind: 'link' });
    });

    it('does not match a different HN path (e.g. /user)', () => {
      expect(detectSource('https://news.ycombinator.com/user?id=pg')).toEqual({ kind: 'link' });
    });

    it('does not match hn.algolia.com (out of scope, deliberately not HN item detection)', () => {
      expect(detectSource('https://hn.algolia.com/?query=id%3D12345')).toEqual({ kind: 'link' });
    });

    it('rejects id=0 (not a valid positive item id)', () => {
      expect(detectSource('https://news.ycombinator.com/item?id=0')).toEqual({ kind: 'link' });
    });
  });

  describe('github', () => {
    it('detects a canonical repo root url', () => {
      expect(detectSource('https://github.com/vercel/next.js')).toEqual({
        kind: 'github',
        owner: 'vercel',
        repo: 'next.js',
      });
    });

    it('detects with a trailing slash', () => {
      expect(detectSource('https://github.com/facebook/react/')).toEqual({
        kind: 'github',
        owner: 'facebook',
        repo: 'react',
      });
    });

    it('detects with www. and http', () => {
      expect(detectSource('http://www.github.com/torvalds/linux')).toEqual({
        kind: 'github',
        owner: 'torvalds',
        repo: 'linux',
      });
    });

    it('strips a trailing .git suffix', () => {
      expect(detectSource('https://github.com/amitray007/silo.git')).toEqual({
        kind: 'github',
        owner: 'amitray007',
        repo: 'silo',
      });
    });

    it('does not match a bare owner (no repo segment)', () => {
      expect(detectSource('https://github.com/amitray007')).toEqual({ kind: 'link' });
    });

    it('does not match a sub-path like /owner/repo/issues', () => {
      expect(detectSource('https://github.com/vercel/next.js/issues/123')).toEqual({
        kind: 'link',
      });
    });

    it('excludes reserved platform paths like /features', () => {
      expect(detectSource('https://github.com/features/actions')).toEqual({ kind: 'link' });
    });

    it('excludes /settings/profile', () => {
      expect(detectSource('https://github.com/settings/profile')).toEqual({ kind: 'link' });
    });

    it('does not match gist urls', () => {
      expect(detectSource('https://github.com/gist/abc123')).toEqual({ kind: 'link' });
    });

    it('does not match a non-github.com host', () => {
      expect(detectSource('https://gitlab.com/owner/repo')).toEqual({ kind: 'link' });
    });
  });

  describe('youtube', () => {
    it('detects a canonical watch url', () => {
      expect(detectSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
        kind: 'youtube',
        videoId: 'dQw4w9WgXcQ',
      });
    });

    it('detects a youtu.be short url', () => {
      expect(detectSource('https://youtu.be/dQw4w9WgXcQ')).toEqual({
        kind: 'youtube',
        videoId: 'dQw4w9WgXcQ',
      });
    });

    it('detects a youtu.be url with extra query params', () => {
      expect(detectSource('https://youtu.be/dQw4w9WgXcQ?t=30')).toEqual({
        kind: 'youtube',
        videoId: 'dQw4w9WgXcQ',
      });
    });

    it('detects with extra query params on youtube.com/watch', () => {
      expect(detectSource('https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2')).toEqual({
        kind: 'youtube',
        videoId: 'dQw4w9WgXcQ',
      });
    });

    it('detects on m.youtube.com', () => {
      expect(detectSource('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
        kind: 'youtube',
        videoId: 'dQw4w9WgXcQ',
      });
    });

    it('does not match the youtube homepage', () => {
      expect(detectSource('https://www.youtube.com/')).toEqual({ kind: 'link' });
    });

    it('does not match a search-results url', () => {
      expect(detectSource('https://www.youtube.com/results?search_query=cats')).toEqual({
        kind: 'link',
      });
    });

    it('does not match a malformed (too short) video id', () => {
      expect(detectSource('https://www.youtube.com/watch?v=short')).toEqual({ kind: 'link' });
    });

    it('does not match a channel url', () => {
      expect(detectSource('https://www.youtube.com/channel/UC123456789012345678901')).toEqual({
        kind: 'link',
      });
    });
  });

  describe('non-matches / edge cases', () => {
    it('returns link for a plain arbitrary url', () => {
      expect(detectSource('https://example.com/some/article')).toEqual({ kind: 'link' });
    });

    it('returns link for an unparseable url', () => {
      expect(detectSource('not a url')).toEqual({ kind: 'link' });
    });

    it('returns link for an empty string', () => {
      expect(detectSource('')).toEqual({ kind: 'link' });
    });

    it('is case-insensitive on host', () => {
      expect(detectSource('https://GITHUB.COM/vercel/next.js')).toEqual({
        kind: 'github',
        owner: 'vercel',
        repo: 'next.js',
      });
    });

    it("does not classify a non-http(s) scheme as a rich source (mirrors canonicalize's scheme gate)", () => {
      // A non-http(s) URL is `ok: false` in canonicalize (not a safe href),
      // so detectSource must not disagree and tag it github/hacker_news/etc.
      expect(detectSource('ftp://github.com/owner/repo')).toEqual({ kind: 'link' });
      expect(detectSource('http://github.com/owner/repo')).toEqual({
        kind: 'github',
        owner: 'owner',
        repo: 'repo',
      });
    });
  });
});
