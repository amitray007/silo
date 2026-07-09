import { describe, expect, it } from 'vitest';
import { canCreate, createTagPicker, filterTags, selectedList, toggleTag } from './tag-list.js';

const ALL = [
  { name: 'react', count: 42 },
  { name: 'react-native', count: 9 },
  { name: 'design', count: 5 },
];

describe('tag picker', () => {
  it('filters by case-insensitive substring', () => {
    const s = createTagPicker(ALL);
    s.query = 'REACT';
    expect(filterTags(s).map((t) => t.name)).toEqual(['react', 'react-native']);
  });

  it('toggles selection', () => {
    const s = createTagPicker(ALL);
    toggleTag(s, 'react');
    expect(selectedList(s)).toEqual(['react']);
    toggleTag(s, 'react');
    expect(selectedList(s)).toEqual([]);
  });

  it('offers create only for a non-matching non-empty query', () => {
    const s = createTagPicker(ALL);
    s.query = 'react';
    expect(canCreate(s)).toBeNull();
    s.query = 'brand-new';
    expect(canCreate(s)).toBe('brand-new');
    s.query = '   ';
    expect(canCreate(s)).toBeNull();
  });
});
