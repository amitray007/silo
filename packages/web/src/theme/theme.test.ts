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

  /**
   * This is the FOUC contract: index.html's inline <script> mirrors this
   * exact resolution order (stored theme, else prefers-color-scheme) so the
   * `data-theme` it sets before first paint matches what this function
   * resolves once React mounts. If any of these cases changes, the inline
   * script (index.html <head>) must change to match, or a dark-mode user
   * gets a flash from the script's guess flipping to React's real answer.
   */
  describe('FOUC contract (must match the inline script in index.html)', () => {
    it('stored dark, system light -> dark', () => {
      expect(resolveInitialTheme({ getItem: () => 'dark' }, fakeMatchMedia(false))).toBe('dark');
    });

    it('stored light, system dark -> light', () => {
      expect(resolveInitialTheme({ getItem: () => 'light' }, fakeMatchMedia(true))).toBe('light');
    });

    it('no storage, system dark -> dark', () => {
      expect(resolveInitialTheme({ getItem: () => null }, fakeMatchMedia(true))).toBe('dark');
    });

    it('no storage, system light -> light', () => {
      expect(resolveInitialTheme({ getItem: () => null }, fakeMatchMedia(false))).toBe('light');
    });

    it('storage throws, system dark -> dark (falls through harmlessly)', () => {
      const throwingStorage = {
        getItem: () => {
          throw new Error('blocked');
        },
      };
      expect(resolveInitialTheme(throwingStorage, fakeMatchMedia(true))).toBe('dark');
    });

    it('storage throws, system light -> light (falls through harmlessly)', () => {
      const throwingStorage = {
        getItem: () => {
          throw new Error('blocked');
        },
      };
      expect(resolveInitialTheme(throwingStorage, fakeMatchMedia(false))).toBe('light');
    });
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
