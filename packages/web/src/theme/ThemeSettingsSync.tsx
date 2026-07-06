import { useEffect, useRef } from 'react';
import { useSettings as useSettingsQuery } from '../api/hooks';
import { useTheme } from './ThemeProvider';
import { readSystemTheme } from './theme';

/**
 * Makes the SERVER's persisted `theme` setting the source of truth on load
 * (plan 016's wiring requirement), while leaving `ThemeProvider`/`theme.ts`'s
 * existing localStorage + `prefers-color-scheme` mechanism completely
 * intact — that mechanism still owns the pre-paint FOUC guard (see
 * `index.html`'s inline script) and the moment-to-moment `data-theme`
 * application; this component only reconciles it against the server ONCE
 * per successful settings load, not on every render.
 *
 * Why a one-time reconcile (guarded by `appliedRef`) rather than a
 * `useEffect` that re-applies on every `settings.theme` change: once this
 * component has synced the server's value in, the user may then flip the
 * toggle locally (`ThemeToggle`'s persist-to-server side effect) — a naive
 * effect keyed on `settings.theme` would fire AGAIN when that PATCH's
 * response lands in the cache (`useUpdateSettings`'s `onSuccess` writes the
 * full map straight into the `settings` query), which would be redundant
 * (harmless — it'd just re-apply the same value the user just picked) but
 * wasteful and a needless second `applyThemeToDocument` call on every toggle
 * click. Applying once, on the FIRST successful load, is exactly the "on
 * load" contract the plan asks for; subsequent cross-tab/cross-session drift
 * is out of scope for this slice (no websocket/polling sync exists anywhere
 * else in this app either).
 *
 * `theme: 'system'` (the default for a never-configured install) resolves to
 * the OS preference at sync time — the same `readSystemTheme` `theme.ts`
 * already uses for the pre-React FOUC guess — rather than introducing a
 * third `data-theme` state; `ThemeProvider`'s applied `Theme` type stays
 * exactly `'light' | 'dark'`, unchanged.
 *
 * `theme`/`setTheme` are read via a ref updated every render (not listed as
 * effect dependencies) — the effect itself must run at most ONCE (guarded by
 * `appliedRef`), so it intentionally reads whatever the LATEST `theme`/
 * `setTheme` are at the moment `settings` first resolves, without
 * re-triggering when either changes afterward.
 */
export function ThemeSettingsSync() {
  const { data: settings } = useSettingsQuery();
  const { theme, setTheme } = useTheme();
  const appliedRef = useRef(false);
  const themeRef = useRef(theme);
  const setThemeRef = useRef(setTheme);
  themeRef.current = theme;
  setThemeRef.current = setTheme;

  useEffect(() => {
    if (appliedRef.current || !settings) return;
    appliedRef.current = true;

    const resolved = settings.theme === 'system' ? readSystemTheme() : settings.theme;
    if (resolved !== themeRef.current) {
      setThemeRef.current(resolved);
    }
  }, [settings]);

  return null;
}
