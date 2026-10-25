import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

export type SettingsTab = 'plugins' | 'prefs' | 'import' | 'access';
export const SETTINGS_TABS = [
  { key: 'plugins', path: 'plugins', name: 'Plugins' },
  { key: 'prefs', path: 'preferences', name: 'Preferences' },
  { key: 'import', path: 'import-export', name: 'Import & export' },
  { key: 'access', path: 'access', name: 'Access' },
] as const;

export function parseSettingsTab(value: string | undefined): SettingsTab | undefined {
  return SETTINGS_TABS.find((tab) => tab.path === value || tab.key === value)?.key;
}
export function settingsPath(tab: SettingsTab): string {
  return `/settings/${SETTINGS_TABS.find((entry) => entry.key === tab)?.path ?? 'plugins'}`;
}

interface SettingsContextValue {
  open: boolean;
  tab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setTab: (tab: SettingsTab) => void;
}
const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Route-backed settings retain the caller's list and reader URL for the return action. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = useRef('/');
  const remembered = useRef<SettingsTab>('plugins');
  const open = /^\/settings(?:\/|$)/.test(location.pathname);
  const routeTab = open ? parseSettingsTab(location.pathname.split('/')[2]) : undefined;
  if (routeTab) remembered.current = routeTab;
  const tab = routeTab ?? remembered.current;
  const openSettings = useCallback(
    (next?: SettingsTab) => {
      if (!open) returnTo.current = `${location.pathname}${location.search}${location.hash}`;
      navigate(settingsPath(next ?? remembered.current));
    },
    [open, location.pathname, location.search, location.hash, navigate],
  );
  const closeSettings = useCallback(() => navigate(returnTo.current), [navigate]);
  const setTab = useCallback((next: SettingsTab) => navigate(settingsPath(next)), [navigate]);
  const value = useMemo(
    () => ({ open, tab, openSettings, closeSettings, setTab }),
    [open, tab, openSettings, closeSettings, setTab],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used within a SettingsProvider');
  return value;
}
