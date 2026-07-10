import { describe, expect, it } from 'vitest';
import { computeEditDiff } from './edit-diff.js';

describe('computeEditDiff', () => {
  it('returns null when nothing changed', () => {
    expect(computeEditDiff({ note: 'a', tags: ['x'] }, { note: 'a', tags: ['x'] })).toBeNull();
  });

  it('detects a changed note', () => {
    expect(computeEditDiff({ note: '', tags: [] }, { note: 'hi', tags: [] })).toEqual({
      note: 'hi',
      addedTags: [],
      removedTags: [],
    });
  });

  it('treats a whitespace-only note change as no change', () => {
    expect(computeEditDiff({ note: 'a', tags: [] }, { note: '  a  ', tags: [] })).toBeNull();
  });

  it('detects added and removed tags, case-insensitively', () => {
    const diff = computeEditDiff(
      { note: '', tags: ['react'] },
      { note: '', tags: ['REACT', 'new'] },
    );
    expect(diff).toEqual({ addedTags: ['new'], removedTags: [] });
  });

  it('detects a removed tag', () => {
    expect(computeEditDiff({ note: '', tags: ['a', 'b'] }, { note: '', tags: ['a'] })).toEqual({
      addedTags: [],
      removedTags: ['b'],
    });
  });
});
