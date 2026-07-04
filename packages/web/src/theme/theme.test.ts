import { describe, expect, it, vi } from 'vitest';
import {
  applyThemeToDocument,
  persistTheme,
  readStoredTheme,
  readSystemTheme,
  resolveInitialTheme,
  THEME_STORAGE_KEY,
} from './theme';

function fakeMatchMedia(matches: boolean): typeof matchMedia {
  return vi.fn().mockReturnValue({ matches }) as unknown as typeof matchMedia;
}

describe('readStoredTheme', () => {
  it('returns null when nothing is stored', () => {
    expect(readStoredTheme({ getItem: () => null })).toBeNull();
  });

  it('returns the stored theme when valid', () => {
    expect(readStoredTheme({ getItem: () => 'dark' })).toBe('dark');
    expect(readStoredTheme({ getItem: () => 'light' })).toBe('light');
  });

  it('ignores garbage values', () => {
    expect(readStoredTheme({ getItem: () => 'purple' })).toBeNull();
  });

  it('returns null when storage throws', () => {
    expect(
      readStoredTheme({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBeNull();
  });
});

describe('readSystemTheme', () => {
  it('returns dark when the OS prefers dark', () => {
    expect(readSystemTheme(fakeMatchMedia(true))).toBe('dark');
  });

  it('returns light when the OS does not prefer dark', () => {
    expect(readSystemTheme(fakeMatchMedia(false))).toBe('light');
  });
});

describe('resolveInitialTheme', () => {
  it('prefers the stored theme over system preference', () => {
    const theme = resolveInitialTheme({ getItem: () => 'dark' }, fakeMatchMedia(false));
    expect(theme).toBe('dark');
  });

  it('falls back to system preference when nothing is stored', () => {
    const theme = resolveInitialTheme({ getItem: () => null }, fakeMatchMedia(true));
    expect(theme).toBe('dark');
  });
});

describe('applyThemeToDocument', () => {
  it('sets data-theme=dark on the root for dark', () => {
    const root = document.createElement('html');
    applyThemeToDocument('dark', root);
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('removes data-theme for light (default :root matches)', () => {
    const root = document.createElement('html');
    root.setAttribute('data-theme', 'dark');
    applyThemeToDocument('light', root);
    expect(root.getAttribute('data-theme')).toBeNull();
  });
});

describe('persistTheme', () => {
  it('writes the theme under the silo-theme key', () => {
    const setItem = vi.fn();
    persistTheme('dark', { setItem });
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
  });

  it('does not throw when storage.setItem throws', () => {
    expect(() =>
      persistTheme('dark', {
        setItem: () => {
          throw new Error('quota exceeded');
        },
      }),
    ).not.toThrow();
  });
});
