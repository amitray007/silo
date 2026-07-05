export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'silo-theme';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

/** Reads a persisted theme choice from localStorage, if any. */
export function readStoredTheme(storage: Pick<Storage, 'getItem'> = localStorage): Theme | null {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    // localStorage can throw (privacy mode, quota) — fall through to system preference.
    return null;
  }
}

/** Falls back to the OS/browser `prefers-color-scheme` when nothing is stored. */
export function readSystemTheme(matchMediaFn: typeof matchMedia = matchMedia): Theme {
  return matchMediaFn('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Keep in sync with the inline FOUC script in index.html's <head> — that
 * script duplicates this exact resolution order (stored theme, else system
 * preference) so the pre-paint `data-theme` it sets matches what this
 * function resolves once React mounts. If this logic changes, mirror the
 * change in index.html or a dark-mode user gets a double flash.
 */
export function resolveInitialTheme(
  storage: Pick<Storage, 'getItem'> = localStorage,
  matchMediaFn: typeof matchMedia = matchMedia,
): Theme {
  return readStoredTheme(storage) ?? readSystemTheme(matchMediaFn);
}

/** Applies the theme to <html> so `:root[data-theme="dark"]` tokens match. */
export function applyThemeToDocument(theme: Theme, root: HTMLElement = document.documentElement) {
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

export function persistTheme(theme: Theme, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Best-effort persistence; a failed write just means it won't survive reload.
  }
}
