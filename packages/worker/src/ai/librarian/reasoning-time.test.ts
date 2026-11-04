import type { TextStreamPart, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import { reasoningTimer } from './reasoning-time.js';

const part = (type: string) => ({ type }) as unknown as TextStreamPart<ToolSet>;

describe('reasoningTimer', () => {
  it('sums each step from its first reasoning delta to its first non-reasoning part', () => {
    let clock = 0;
    const metadata = reasoningTimer(() => clock);
    const feed = (type: string, at: number) => {
      clock = at;
      return metadata({ part: part(type) });
    };
    expect(feed('start-step', 0)).toBeUndefined();
    expect(feed('reasoning-start', 100)).toBeUndefined();
    expect(feed('reasoning-delta', 1000)).toBeUndefined();
    expect(feed('reasoning-delta', 2500)).toBeUndefined();
    expect(feed('reasoning-end', 3000)).toBeUndefined();
    expect(feed('tool-input-start', 4000)).toEqual({ reasoningMs: 3000 });
    expect(feed('text-delta', 5000)).toBeUndefined();
    expect(feed('reasoning-delta', 6000)).toBeUndefined();
    expect(feed('text-start', 6500)).toEqual({ reasoningMs: 3500 });
  });

  it('reports nothing for a step without reasoning', () => {
    const metadata = reasoningTimer(() => 1);
    expect(metadata({ part: part('text-delta') })).toBeUndefined();
    expect(metadata({ part: part('finish') })).toBeUndefined();
  });
});
