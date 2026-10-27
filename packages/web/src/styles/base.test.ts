import { describe, expect, it } from 'vitest';

describe('base styles', () => {
  it('tokens.css imports without error', async () => {
    await expect(import('./tokens.css')).resolves.toBeDefined();
  });

  it('base.css (fonts + tokens + reset) imports without error', async () => {
    await expect(import('./base.css')).resolves.toBeDefined();
  });
});
