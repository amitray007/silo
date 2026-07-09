import { describe, expect, it } from 'vitest';
import { canCreate, filterTags } from './tag-picker.js';

const ALL = [
  { name: 'react', count: 42 },
  { name: 'reactivity', count: 4 },
  { name: 'design', count: 5 },
];

describe('tag-picker model', () => {
  it('filters case-insensitively', () => {
    expect(filterTags(ALL, 'REACT').map((t) => t.name)).toEqual(['react', 'reactivity']);
  });
  it('offers create only for a novel non-empty query', () => {
    expect(canCreate(ALL, 'react')).toBeNull();
    expect(canCreate(ALL, 'new')).toBe('new');
    expect(canCreate(ALL, '  ')).toBeNull();
  });
});
