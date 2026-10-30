import { describe, expect, it } from 'vitest';
import { normalizeFeedUrl } from './types.js';

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
