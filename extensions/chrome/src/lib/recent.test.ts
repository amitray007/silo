import { describe, expect, it } from 'vitest';
import { getRecentIds, trackCapturedId } from './recent.js';

describe('recent', () => {
  it('starts empty', async () => {
    expect(await getRecentIds()).toEqual([]);
  });

  it('tracks a captured id, most recent first', async () => {
    await trackCapturedId('a');
    await trackCapturedId('b');
    expect(await getRecentIds()).toEqual(['b', 'a']);
  });

  it('de-duplicates: re-capturing an id moves it to the front instead of appearing twice', async () => {
    await trackCapturedId('a');
    await trackCapturedId('b');
    await trackCapturedId('a');
    expect(await getRecentIds()).toEqual(['a', 'b']);
  });

  it('caps at 5, dropping the oldest', async () => {
    for (const id of ['1', '2', '3', '4', '5', '6']) {
      await trackCapturedId(id);
    }
    expect(await getRecentIds()).toEqual(['6', '5', '4', '3', '2']);
  });
});
