import { describe, expect, it } from 'vitest';
import { deriveDomain, deriveTitleFromUrl, looksLikeUrl } from './url';

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
    expect(deriveTitleFromUrl('ftp://example.com/file')).toBe('ftp://example.com/file');
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
