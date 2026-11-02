import { describe, expect, it } from 'vitest';
import { ReplayCache } from './replayCache';

const audio = (samples: number) => ({ chunks: [new Float32Array(samples)], sampleRate: 24000 });

describe('ReplayCache', () => {
  it('returns what it stored and counts bytes', () => {
    const cache = new ReplayCache(1000);
    cache.set('a', audio(10));
    expect(cache.get('a')?.chunks[0]?.length).toBe(10);
    expect(cache.bytes).toBe(40);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts the least recently used entry past the cap', () => {
    const cache = new ReplayCache(400); // 100 samples
    cache.set('a', audio(40));
    cache.set('b', audio(40));
    cache.get('a'); // a is now the newest
    cache.set('c', audio(40));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
    expect(cache.bytes).toBeLessThanOrEqual(400);
  });

  it('replacing a key does not double count it', () => {
    const cache = new ReplayCache(1000);
    cache.set('a', audio(10));
    cache.set('a', audio(20));
    expect(cache.bytes).toBe(80);
    expect(cache.size).toBe(1);
  });

  it('keeps one entry even when it alone is over the cap', () => {
    const cache = new ReplayCache(100);
    cache.set('big', audio(500));
    expect(cache.get('big')).toBeDefined();
  });
});
