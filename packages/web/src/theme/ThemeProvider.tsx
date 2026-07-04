import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { applyThemeToDocument, persistTheme, resolveInitialTheme, type Theme } from './theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Owns the light/dark theme: resolves the initial value (localStorage, else
 * prefers-color-scheme), applies `data-theme` to <html>, and persists changes.
 *
 * The initial theme is resolved during render (before first paint commits),
 * so there is no flash-of-wrong-theme for a client-only SPA mounted after
 * this provider renders. A flash on the very first HTML paint (before React
 * mounts) is possible and accepted for this slice — see plan W2.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = resolveInitialTheme();
    applyThemeToDocument(initial);
    return initial;
  });

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyThemeToDocument(next);
    persistTheme(next);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      applyThemeToDocument(next);
      persistTheme(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
