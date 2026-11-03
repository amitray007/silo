import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

export type SettingsTab = 'plugins' | 'ai' | 'prefs' | 'reader' | 'import' | 'access';
const SETTINGS_TABS = [
  { key: 'plugins', path: 'plugins' },
  { key: 'ai', path: 'ai' },
  { key: 'prefs', path: 'preferences' },
  { key: 'reader', path: 'reader' },
  { key: 'import', path: 'import-export' },
  { key: 'access', path: 'access' },
] as const;
export function parseSettingsTab(value: string | undefined): SettingsTab | undefined {
  return SETTINGS_TABS.find((tab) => tab.path === value || tab.key === value)?.key;
}
interface SettingsContextValue {
  open: boolean;
  tab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  setTab: (tab: SettingsTab) => void;
  pluginFocus: string | null;
  focusPlugin: (name: string) => void;
  clearPluginFocus: () => void;
}
const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Modal state preserves the list and reader URL when Settings opens. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, selectTab] = useState<SettingsTab>('plugins');
  const [pluginFocus, setPluginFocus] = useState<string | null>(null);
  const clearPluginFocus = useCallback(() => setPluginFocus(null), []);
  const setTab = useCallback((next: SettingsTab) => {
    setPluginFocus(null);
    selectTab(next);
  }, []);
  const focusPlugin = useCallback((name: string) => {
    document.getElementById('settings-tab-plugins')?.focus();
    setPluginFocus(name);
    selectTab('plugins');
  }, []);
  const location = useLocation();
  const navigate = useNavigate();
  const previousPath = useRef(location.pathname);
  const openSettings = useCallback((next?: SettingsTab) => {
    setOpen(true);
    setPluginFocus(null);
    if (next) selectTab(next);
  }, []);
  const closeSettings = useCallback(() => {
    setPluginFocus(null);
    setOpen(false);
  }, []);
  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      previousPath.current = location.pathname;
      closeSettings();
    }
    const next = parseSettingsTab(location.state?.settingsTab);
    if (next) {
      openSettings(next);
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: null,
      });
    }
  }, [
    location.pathname,
    location.search,
    location.hash,
    location.state,
    navigate,
    openSettings,
    closeSettings,
  ]);
  const value = useMemo(
    () => ({
      open,
      tab,
      openSettings,
      closeSettings,
      setTab,
      pluginFocus,
      focusPlugin,
      clearPluginFocus,
    }),
    [open, tab, openSettings, closeSettings, setTab, pluginFocus, focusPlugin, clearPluginFocus],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used within a SettingsProvider');
  return value;
}
