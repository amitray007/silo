import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_URL, getSettings, saveSettings } from './settings.js';

describe('settings', () => {
  it('defaults to localhost:8787 and an empty token when unset', async () => {
    expect(await getSettings()).toEqual({ baseUrl: DEFAULT_BASE_URL, token: '' });
  });

  it('persists and reloads a custom base URL and token', async () => {
    await saveSettings({ baseUrl: 'https://silo.example.com', token: 'abc123' });
    expect(await getSettings()).toEqual({ baseUrl: 'https://silo.example.com', token: 'abc123' });
  });

  it('falls back to the default base URL if stored as an empty/whitespace string', async () => {
    await saveSettings({ baseUrl: '   ', token: '' });
    expect((await getSettings()).baseUrl).toBe(DEFAULT_BASE_URL);
  });
});
