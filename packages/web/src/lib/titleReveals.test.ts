import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTitleReveal, markTitleEdited, registerTitleReveal } from './titleReveals';

afterEach(() => {
  vi.useRealTimers();
});

describe('pending title reveals', () => {
  it('expires pending reveals and edit markers after two minutes on access', () => {
    vi.useFakeTimers();
    registerTitleReveal('expires', 'Old title');
    markTitleEdited('edited');
    vi.advanceTimersByTime(119_999);
    expect(getTitleReveal('expires')?.kind).toBe('pending');
    expect(getTitleReveal('edited')?.kind).toBe('edit');
    vi.advanceTimersByTime(1);
    expect(getTitleReveal('expires')).toBeUndefined();
    expect(getTitleReveal('edited')).toBeUndefined();
  });

  it('evicts the oldest entries and keeps at most 256', () => {
    for (let index = 0; index < 300; index++) registerTitleReveal(`cap-${index}`, 'Old');
    const retained = Array.from({ length: 300 }, (_, index) => getTitleReveal(`cap-${index}`));
    expect(retained.filter(Boolean)).toHaveLength(256);
    expect(getTitleReveal('cap-43')).toBeUndefined();
    expect(getTitleReveal('cap-44')?.kind).toBe('pending');
    expect(getTitleReveal('cap-299')?.kind).toBe('pending');
  });
});
