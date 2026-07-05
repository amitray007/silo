import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

export type SettingsTab = 'plugins' | 'prefs' | 'import' | 'access';

interface SettingsContextValue {
  /** Whether the Settings modal is open (v3's `settingsOpen`). */
  open: boolean;
  /** Which tab is active (v3's `tab`) — only meaningful while `open`. */
  tab: SettingsTab;
  /** Opens the modal, optionally jumping straight to a tab (defaults to staying on whatever tab was last active — v3 always reopens on `plugins` since it never persists `tab` across a close, but we keep the last tab so the `/settings` route and the sidebar button behave identically whichever one is used). */
  openSettings: (tab?: SettingsTab) => void;
  /** Closes the modal without resetting `tab` (matches v3's `closeSettings`, which never touches `tab`). */
  closeSettings: () => void;
  /** Switches tabs while the modal is open. */
  setTab: (tab: SettingsTab) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Settings modal open-state (plan 011, V3-7) — lifted to ONE provider
 * (mounted in `AppFrame`, alongside `RowMenuProvider`/`SelectionProvider`) so
 * both the sidebar's Settings button AND the `/settings` route can open the
 * SAME modal instance without either owning the other's state. Mirrors
 * `RowMenuContext`'s shape/rationale: a single source of truth prevents two
 * independent "is settings open" booleans from drifting.
 *
 * `tab` defaults to `'plugins'` (v3's initial `this.state.tab`).
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('plugins');

  const openSettings = useCallback((nextTab?: SettingsTab) => {
    setOpen(true);
    if (nextTab) setTab(nextTab);
  }, []);

  const closeSettings = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, tab, openSettings, closeSettings, setTab }),
    [open, tab, openSettings, closeSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
