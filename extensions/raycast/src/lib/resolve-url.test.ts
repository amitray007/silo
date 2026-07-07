import { beforeEach, describe, expect, it, vi } from 'vitest';

const runAppleScript = vi.fn();
const readText = vi.fn();

vi.mock('@raycast/utils', () => ({
  runAppleScript: (...args: unknown[]) => runAppleScript(...args),
}));

vi.mock('@raycast/api', () => ({
  Clipboard: { readText: (...args: unknown[]) => readText(...args) },
}));

describe('resolveUrl', () => {
  beforeEach(() => {
    runAppleScript.mockReset();
    readText.mockReset();
  });

  it('resolves the frontmost Chromium browser tab (System Events reports it frontmost)', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Google Chrome';
      if (script.includes('Google Chrome')) return 'https://example.com/page␟Example Page';
      throw new Error('unexpected script');
    });

    const { resolveUrl } = await import('./resolve-url.js');
    const result = await resolveUrl();

    expect(result).toEqual({
      url: 'https://example.com/page',
      title: 'Example Page',
      source: 'browser',
    });
  });

  it('does not corrupt a URL whose query string itself contains ", " (regression: the parser previously split on the first literal comma-space, before switching to a dedicated field separator)', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Google Chrome';
      if (script.includes('Google Chrome')) {
        return 'https://example.com/search?q=foo, bar␟Search results';
      }
      throw new Error('unexpected script');
    });

    const { resolveUrl } = await import('./resolve-url.js');
    const result = await resolveUrl();

    expect(result).toEqual({
      url: 'https://example.com/search?q=foo, bar',
      title: 'Search results',
      source: 'browser',
    });
  });

  it('falls back to the clipboard when no supported browser is frontmost', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Finder';
      throw new Error('should not query a non-frontmost browser');
    });
    readText.mockResolvedValue('https://clipboard-url.com/thing');

    const { resolveUrl } = await import('./resolve-url.js');
    const result = await resolveUrl();

    expect(result).toEqual({ url: 'https://clipboard-url.com/thing', source: 'clipboard' });
  });

  it('degrades gracefully when a Chromium browser is frontmost but its AppleScript surface throws (e.g. Dia mismatch) — falls through to clipboard', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Dia';
      if (script.includes('Dia')) throw new Error('AppleScript dictionary mismatch');
      throw new Error('unexpected script');
    });
    readText.mockResolvedValue('https://fallback.example.com');

    const { resolveUrl } = await import('./resolve-url.js');
    const result = await resolveUrl();

    expect(result).toEqual({ url: 'https://fallback.example.com', source: 'clipboard' });
  });

  it('returns undefined when no browser is frontmost and the clipboard has no URL', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Finder';
      throw new Error('should not query a non-frontmost browser');
    });
    readText.mockResolvedValue('just some text, not a url');

    const { resolveUrl } = await import('./resolve-url.js');
    const result = await resolveUrl();

    expect(result).toBeUndefined();
  });

  it('rejects a non-http(s) clipboard value (e.g. a file path)', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Finder';
      throw new Error('should not query a non-frontmost browser');
    });
    readText.mockResolvedValue('/Users/me/file.txt');

    const { resolveUrl } = await import('./resolve-url.js');
    expect(await resolveUrl()).toBeUndefined();
  });

  it('tries Safari after the Chromium family when none of those are frontmost', async () => {
    runAppleScript.mockImplementation(async (script: string) => {
      if (script.includes('System Events')) return 'Safari';
      if (script.includes('Safari')) return 'https://safari-example.com␟Safari Page';
      throw new Error('unexpected script');
    });

    const { resolveUrl } = await import('./resolve-url.js');
    const result = await resolveUrl();

    expect(result).toEqual({
      url: 'https://safari-example.com',
      title: 'Safari Page',
      source: 'browser',
    });
  });
});

describe('isHttpUrl', () => {
  it('accepts http(s) URLs and rejects everything else', async () => {
    const { isHttpUrl } = await import('./resolve-url.js');
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('/local/path')).toBe(false);
  });
});
