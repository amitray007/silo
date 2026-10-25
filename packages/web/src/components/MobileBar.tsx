import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useUpdateSettings } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { layoutMedia, useMediaQuery } from '../lib/breakpoints';
import { useTheme } from '../theme/ThemeProvider';
import { MenuPresence } from './MenuPresence';
import { MenuAction, MenuSurface } from './MenuSurface';
import { ReaderIcon } from './reader/ReaderIcon';
import { useSettings } from './SettingsContext';

export function MobileBar({ onSearch }: { onSearch: () => void }) {
  const { state: authState, logout } = useAuth();
  const phone = useMediaQuery(layoutMedia.phone);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { openSettings } = useSettings();
  const { theme, setTheme } = useTheme();
  const updateSettings = useUpdateSettings();
  const dark = theme === 'dark';
  useEffect(() => {
    if (!phone) setOpen(false);
  }, [phone]);
  if (!phone) return null;
  return (
    <nav className="silo-mobile-bar" aria-label="Phone navigation">
      <button
        type="button"
        className="silo-mobile-bar-button"
        aria-label="Library"
        aria-current={location.pathname === '/' ? 'page' : undefined}
        onClick={() => {
          setOpen(false);
          navigate('/');
        }}
      >
        <ReaderIcon name="library" size={28} />
      </button>
      <button
        type="button"
        className="silo-mobile-bar-button"
        aria-label="Search"
        onClick={() => {
          setOpen(false);
          onSearch();
        }}
      >
        <ReaderIcon name="search" size={28} />
      </button>
      <button
        type="button"
        className="silo-mobile-bar-button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ReaderIcon name="more" size={28} />
      </button>
      <MenuPresence>
        {open && (
          <MenuSurface sheet={false} className="silo-mobile-more" onClose={() => setOpen(false)}>
            <MenuAction
              icon={<ReaderIcon name="trash" />}
              onClick={() => {
                setOpen(false);
                navigate('/trash');
              }}
            >
              Trash
            </MenuAction>
            <MenuAction
              icon={<ReaderIcon name="settings" />}
              onClick={() => {
                setOpen(false);
                openSettings();
              }}
            >
              Settings
            </MenuAction>
            <MenuAction
              icon={<ReaderIcon name={dark ? 'sun' : 'moon'} />}
              onClick={() => {
                const next = dark ? 'light' : 'dark';
                setTheme(next);
                updateSettings.mutate({ theme: next });
                setOpen(false);
              }}
            >
              {dark ? 'Light mode' : 'Dark mode'}
            </MenuAction>
            {authState === 'authed' && (
              <MenuAction
                icon={<ReaderIcon name="logout" />}
                onClick={() => {
                  setOpen(false);
                  logout();
                }}
              >
                Log out
              </MenuAction>
            )}
            {import.meta.env.DEV && (
              <MenuAction
                icon={<ReaderIcon name="edit" />}
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new Event('silo:annotate'));
                }}
              >
                Annotate page
              </MenuAction>
            )}
          </MenuSurface>
        )}
      </MenuPresence>
    </nav>
  );
}
