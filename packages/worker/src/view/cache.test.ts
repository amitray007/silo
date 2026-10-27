import { describe, expect, it } from 'vitest';
import { PageCache } from './cache.js';

describe('byte-budgeted page cache', () => {
  it('evicts by bytes and recency, counting multibyte text and keys', () => {
    const cache = new PageCache<Buffer>(12);
    const value = Buffer.from('éé');
    cache.set('a', value, value.byteLength);
    cache.set('b', value, value.byteLength);
    expect(cache.get('a')?.toString()).toBe('éé');
    cache.set('c', value, value.byteLength);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(value);
    expect(cache.get('c')).toBe(value);
  });
  it('does not retain a single page above the budget', () => {
    const cache = new PageCache<string>(4);
    cache.set('id', '123', 3);
    expect(cache.get('id')).toBeUndefined();
  });
  it('expires at ten minutes even when accessed, and reclaims replaced/expired bytes', () => {
    let now = 0;
    const cache = new PageCache<string>(10, undefined, () => now);
    cache.set('a', 'old', 8);
    now = 599_999;
    expect(cache.get('a')).toBe('old');
    now = 600_000;
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', 'new', 8);
    cache.set('a', 'small', 1);
    cache.set('b', 'other', 7);
    expect(cache.get('a')).toBe('small');
    expect(cache.get('b')).toBe('other');
    cache.clear();
    expect(cache.get('b')).toBeUndefined();
  });
});
