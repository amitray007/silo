import { describe, expect, it } from 'vitest';
import { nextLayer } from './layers';

describe('nextLayer', () => {
  it('starts at the innermost layer', () => {
    expect(nextLayer(null, { x: 10, y: 10 }, 3, 1000).index).toBe(0);
  });

  it('walks outward on repeat clicks in the same spot and wraps', () => {
    let memory = nextLayer(null, { x: 10, y: 10 }, 3, 1000).memory;
    const seen: number[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const step = nextLayer(memory, { x: 12, y: 11 }, 3, 1000 + i * 500);
      seen.push(step.index);
      memory = step.memory;
    }
    expect(seen).toEqual([1, 2, 0, 1]);
  });

  it('starts over after the pointer moves 6px or more', () => {
    const first = nextLayer(null, { x: 10, y: 10 }, 3, 1000);
    expect(nextLayer(first.memory, { x: 16, y: 10 }, 3, 1500).index).toBe(0);
  });

  it('starts over after 4 seconds', () => {
    const first = nextLayer(null, { x: 10, y: 10 }, 3, 1000);
    expect(nextLayer(first.memory, { x: 10, y: 10 }, 3, 5000).index).toBe(0);
  });
});
