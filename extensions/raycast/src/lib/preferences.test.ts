import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPreferenceValues = vi.fn();

vi.mock('@raycast/api', () => ({
  getPreferenceValues: (...args: unknown[]) => getPreferenceValues(...args),
}));

describe('preferences', () => {
  beforeEach(() => {
    getPreferenceValues.mockReset();
  });

  it('getBaseUrl returns the configured baseUrl', async () => {
    getPreferenceValues.mockReturnValue({ baseUrl: 'https://silo.example.com' });
    const { getBaseUrl } = await import('./preferences.js');
    expect(getBaseUrl()).toBe('https://silo.example.com');
  });

  it('getBaseUrl falls back to the default when unset/blank', async () => {
    getPreferenceValues.mockReturnValue({ baseUrl: '   ' });
    const { getBaseUrl, DEFAULT_BASE_URL } = await import('./preferences.js');
    expect(getBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  it('getToken returns the configured token, trimmed', async () => {
    getPreferenceValues.mockReturnValue({ baseUrl: 'x', token: '  sekret  ' });
    const { getToken } = await import('./preferences.js');
    expect(getToken()).toBe('sekret');
  });

  it('getToken returns undefined when unset', async () => {
    getPreferenceValues.mockReturnValue({ baseUrl: 'x' });
    const { getToken } = await import('./preferences.js');
    expect(getToken()).toBeUndefined();
  });
});
