import { AI_FEATURES } from '@silo/core';
import { describe, expect, it } from 'vitest';
import { AI_FEATURE_DEFINITIONS, assertAiRegistryMatchesCore } from './registry.js';

describe('AI feature registry', () => {
  it('loads without drift and matches core', () => {
    expect(AI_FEATURE_DEFINITIONS.map((d) => d.id)).toEqual(AI_FEATURES.map((f) => f.id));
  });
});

describe('assertAiRegistryMatchesCore', () => {
  it('accepts matching ids in any order', () => {
    expect(() => assertAiRegistryMatchesCore(['a', 'b'], ['b', 'a'])).not.toThrow();
  });

  it('throws for a core-only id', () => {
    expect(() => assertAiRegistryMatchesCore(['a'], ['a', 'b'])).toThrow(
      /without a worker definition \[b\]/,
    );
  });

  it('throws for a worker-only id', () => {
    expect(() => assertAiRegistryMatchesCore(['a', 'c'], ['a'])).toThrow(
      /without a core feature \[c\]/,
    );
  });
});
