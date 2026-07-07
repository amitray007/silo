import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from './concurrency.js';

describe('runWithConcurrency', () => {
  it('runs every item exactly once', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const seen: number[] = [];
    await runWithConcurrency(items, 5, async (item) => {
      seen.push(item);
      return item;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it('never exceeds the concurrency limit', async () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;

    await runWithConcurrency(items, 5, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return item;
    });

    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  it('reports both successes and failures via onResult without aborting the whole run', async () => {
    const items = [1, 2, 3, 4];
    const results: { item: number; ok: boolean }[] = [];

    await runWithConcurrency(
      items,
      2,
      async (item) => {
        if (item === 2) throw new Error('boom');
        return item * 10;
      },
      (result) => {
        results.push({ item: result.item, ok: result.ok });
      },
    );

    expect(results.sort((a, b) => a.item - b.item)).toEqual([
      { item: 1, ok: true },
      { item: 2, ok: false },
      { item: 3, ok: true },
      { item: 4, ok: true },
    ]);
  });

  it('handles an empty item list as a no-op', async () => {
    let called = false;
    await runWithConcurrency([], 5, async () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it('handles a limit larger than the item count without creating extra workers', async () => {
    const items = [1, 2];
    let calls = 0;
    await runWithConcurrency(items, 100, async (item) => {
      calls += 1;
      return item;
    });
    expect(calls).toBe(2);
  });
});
