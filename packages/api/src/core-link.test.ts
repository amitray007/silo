import { name as coreName } from '@silo/core';
import { describe, expect, it } from 'vitest';

describe('@silo/api -> @silo/core workspace link', () => {
  it('resolves the @silo/core placeholder through the workspace:* dependency', () => {
    expect(coreName).toBeDefined();
    expect(coreName).toBe('@silo/core');
  });
});
