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

export type SettingsTab = 'plugins' | 'ai' | 'prefs' | 'import' | 'access';
const SETTINGS_TABS = [
  { key: 'plugins', path: 'plugins' },
  { key: 'ai', path: 'ai' },
  { key: 'prefs', path: 'preferences' },
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
}
const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Modal state preserves the list and reader URL when Settings opens. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('plugins');
  const location = useLocation();
  const navigate = useNavigate();
  const previousPath = useRef(location.pathname);
  const openSettings = useCallback((next?: SettingsTab) => {
    setOpen(true);
    if (next) setTab(next);
  }, []);
  const closeSettings = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      previousPath.current = location.pathname;
      setOpen(false);
    }
    const next = parseSettingsTab(location.state?.settingsTab);
    if (next) {
      openSettings(next);
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: null,
      });
    }
  }, [location.pathname, location.search, location.hash, location.state, navigate, openSettings]);
  const value = useMemo(
    () => ({ open, tab, openSettings, closeSettings, setTab }),
    [open, tab, openSettings, closeSettings],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used within a SettingsProvider');
  return value;
}
