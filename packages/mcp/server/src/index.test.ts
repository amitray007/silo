import { describe, expect, it } from 'vitest';
import { name } from './index.js';

describe('@silo/mcp-server placeholder', () => {
  it('exports a defined marker', () => {
    expect(name).toBeDefined();
    expect(name).toBe('@silo/mcp-server');
  });
});
