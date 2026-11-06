import { describe, expect, it } from 'vitest';
import { deriveDomain, deriveTitleFromUrl, looksLikeUrl, normalizeFeedUrl, siteName } from './url';

describe('deriveDomain', () => {
  it('returns the hostname for a valid url', () => {
    expect(deriveDomain('https://example.com/a/b?c=1')).toBe('example.com');
  });

  it('strips a leading www.', () => {
    expect(deriveDomain('https://www.example.com/path')).toBe('example.com');
  });

  it('only strips a leading www. (case-insensitive), not an inner one', () => {
    expect(deriveDomain('https://WWW.Example.com')).toBe('example.com');
    expect(deriveDomain('https://foo.www.example.com')).toBe('foo.www.example.com');
  });

  it('falls back to the raw input for garbage/bare input', () => {
    expect(deriveDomain('not a url')).toBe('not a url');
    expect(deriveDomain('example.com')).toBe('example.com');
  });

  it('handles both http and https schemes', () => {
    expect(deriveDomain('http://insecure.example.com')).toBe('insecure.example.com');
    expect(deriveDomain('https://secure.example.com')).toBe('secure.example.com');
  });
});

describe('deriveTitleFromUrl', () => {
  it('strips an https scheme', () => {
    expect(deriveTitleFromUrl('https://example.com/post')).toBe('example.com/post');
  });

  it('strips an http scheme', () => {
    expect(deriveTitleFromUrl('http://example.com/post')).toBe('example.com/post');
  });

  it('passes through scheme-less or non-http(s) input unchanged', () => {
    expect(deriveTitleFromUrl('example.com/post')).toBe('example.com/post');
    expect(deriveTitleFromUrl('ftp://example.com/file')).toBe('example.com/file');
  });
});

describe('looksLikeUrl', () => {
  it('accepts an explicit http(s) URL', () => {
    expect(looksLikeUrl('https://example.com')).toBe(true);
    expect(looksLikeUrl('http://example.com/path?q=1')).toBe(true);
  });

  it('accepts a scheme-less bare domain paste', () => {
    expect(looksLikeUrl('example.com')).toBe(true);
    expect(looksLikeUrl('example.com/some/path')).toBe(true);
    expect(looksLikeUrl('sub.example.co.uk')).toBe(true);
  });

  it('rejects plain search text (no dot-tld shape)', () => {
    expect(looksLikeUrl('react hooks')).toBe(false);
    expect(looksLikeUrl('typescript')).toBe(false);
  });

  it('rejects text containing whitespace even if it has a dot', () => {
    expect(looksLikeUrl('example.com is nice')).toBe(false);
  });

  it('rejects empty/blank input', () => {
    expect(looksLikeUrl('')).toBe(false);
    expect(looksLikeUrl('   ')).toBe(false);
  });
});

describe('normalizeFeedUrl', () => {
  it.each(['example.com:8080/feed', 'localhost:8080'])('adds https to %s', (value) => {
    expect(normalizeFeedUrl(` ${value} `)).toBe(`https://${value}`);
  });
  it.each([
    'https://example.com/feed',
    'http://localhost:8080',
    'ftp://example.com/feed',
    'javascript:alert(1)',
    'data:text/plain,feed',
    'mailto:owner@example.com',
  ])('preserves %s for scheme validation', (value) => {
    expect(normalizeFeedUrl(value)).toBe(value);
  });
});

describe('siteName', () => {
  it('drops the suffix and any subdomain', () => {
    expect(siteName('simonwillison.net')).toBe('simonwillison');
    expect(siteName('www.news.example.org')).toBe('example');
  });

  it('drops a two-part suffix', () => {
    expect(siteName('bbc.co.uk')).toBe('bbc');
  });

  it('passes a single-label host through', () => {
    expect(siteName('localhost')).toBe('localhost');
  });
});

it.each([
  [
    'https://bigthink.com/the-well/the-consciousness-theory-that-connects-you-to-everything/?utm_source=x',
    'The consciousness theory that connects you to everything',
  ],
  ['https://example.com/?q=1', 'example.com'],
  ['https://github.com/amitray007/silo', 'github.com/amitray007/silo'],
  ['https://example.com/post/12345', 'example.com/post/12345'],
  ['bad input', 'bad input'],
  ['https://example.com/a/my_post.html', 'My post'],
])('derives title from %s', (url, title) => expect(deriveTitleFromUrl(url)).toBe(title));
