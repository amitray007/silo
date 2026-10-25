import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useMatch } from 'react-router';
import { useCommandPalette } from '../lib/useCommandPalette';
import { isTextEntryElement, usePasteCapture } from '../lib/usePasteCapture';
import { ThemeSettingsSync } from '../theme/ThemeSettingsSync';
import { CommandPalette } from './CommandPalette';
import { EditModal } from './EditModal';
import { HoverPreviewProvider } from './HoverPreviewContext';
import { RowMenuProvider, useRowMenu } from './RowMenuContext';
import { ReaderIcon } from './reader/ReaderIcon';
import { SelectionProvider, useLibrarySelection, useTrashSelection } from './SelectionContext';
import { SettingsProvider, useSettings } from './SettingsContext';
import { Sidebar } from './Sidebar';

const DRAWER_ID = 'silo-drawer';
const COLLAPSED_KEY = 'silo.sidebarCollapsed';

function RowMenuLayer({
  palette,
  drawerOpen,
}: {
  palette: ReturnType<typeof useCommandPalette>;
  drawerOpen: boolean;
}) {
  const { openMenuId, closeMenu, editingLink, editingFocus, closeEdit } = useRowMenu();
  const librarySelection = useLibrarySelection();
  const trashSelection = useTrashSelection();
  const { open: settingsOpen } = useSettings();
  useEffect(() => {
    if (settingsOpen && editingLink) {
      closeEdit();
    }
  }, [settingsOpen, editingLink, closeEdit]);
  useEffect(() => {
    if (editingLink && palette.open) {
      palette.closePalette();
    }
  }, [editingLink, palette.open, palette.closePalette]);
  useEffect(() => {
    if ((palette.open || drawerOpen) && openMenuId !== null) {
      closeMenu();
    }
  }, [palette.open, drawerOpen, openMenuId, closeMenu]);
  useEffect(() => {
    if (openMenuId === null) return;
    const onMouseDown = () => closeMenu();
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [openMenuId, closeMenu]);
  useEffect(() => {
    const dismiss =
      openMenuId !== null
        ? closeMenu
        : [librarySelection, trashSelection].find((scope) => scope.selected.length > 0)?.clear;
    if (!dismiss) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        palette.open ||
        drawerOpen ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [data-reader-menu]')
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openMenuId, closeMenu, librarySelection, trashSelection, palette.open, drawerOpen]);
  return editingLink ? (
    <EditModal key={editingLink.id} link={editingLink} focus={editingFocus} />
  ) : null;
}

function initialCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function AppFrame() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const drawerWasOpen = useRef(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const previousPath = useRef(location.pathname);
  const currentTag = useMatch('/tags/:name')?.params.name;
  usePasteCapture(currentTag);
  const commandPalette = useCommandPalette();
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleSidebar = useCallback(() => {
    if (!matchMedia('(min-width: 1100px)').matches) {
      closeDrawer();
      return;
    }
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSED_KEY, String(next));
      } catch {
        /* Storage may be unavailable. */
      }
      return next;
    });
  }, [closeDrawer]);
  const showSidebar = () => {
    if (drawerOpen) {
      closeDrawer();
      return;
    }
    if (matchMedia('(min-width: 1100px)').matches) {
      toggleSidebar();
      return;
    }
    setDrawerOpen(true);
  };

  useEffect(() => {
    if (previousPath.current !== location.pathname) {
      previousPath.current = location.pathname;
      setDrawerOpen(false);
      commandPalette.closePalette();
    }
  }, [location.pathname, commandPalette.closePalette]);
  useEffect(() => {
    const wide = matchMedia('(min-width: 1100px)');
    const onChange = () => setDrawerOpen(false);
    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTextEntryElement(event.target) ||
        isTextEntryElement(document.activeElement) ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [data-reader-menu]')
      )
        return;
      if (event.key === '[') {
        event.preventDefault();
        if (matchMedia('(min-width: 1100px)').matches) toggleSidebar();
        else setDrawerOpen((open) => !open);
      }
      if (event.key === 'n') {
        event.preventDefault();
        commandPalette.openPalette();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleSidebar, commandPalette.openPalette]);
  useEffect(() => {
    if (!drawerOpen) {
      if (drawerWasOpen.current && !document.querySelector('[role="dialog"], [role="alertdialog"]'))
        menuButtonRef.current?.focus();
      drawerWasOpen.current = false;
      return;
    }
    drawerWasOpen.current = true;
    sidebarRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeDrawer();
      }
      if (event.key !== 'Tab') return;
      const nav = sidebarRef.current;
      const elements = nav?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input');
      const first = elements?.[0];
      const last = elements?.[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === nav)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [drawerOpen, closeDrawer]);

  return (
    <SettingsProvider>
      <ThemeSettingsSync />
      <HoverPreviewProvider>
        <RowMenuProvider>
          <SelectionProvider>
            <div className="silo-frame" data-collapsed={collapsed}>
              <div className="silo-band">
                <button
                  type="button"
                  tabIndex={-1}
                  className="silo-scrim"
                  data-open={drawerOpen}
                  aria-hidden="true"
                  onClick={closeDrawer}
                />
                <Sidebar
                  id={DRAWER_ID}
                  ref={sidebarRef}
                  open={drawerOpen}
                  onNavigate={closeDrawer}
                  onOpenSearch={() => {
                    closeDrawer();
                    commandPalette.openPalette();
                  }}
                  onToggleSidebar={toggleSidebar}
                />
                <main className="silo-content" inert={drawerOpen}>
                  <button
                    ref={menuButtonRef}
                    type="button"
                    className="silo-list-menu silo-reader-iconbtn"
                    aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
                    aria-expanded={drawerOpen}
                    aria-controls={DRAWER_ID}
                    onClick={showSidebar}
                  >
                    <ReaderIcon name="menu" />
                  </button>
                  <Outlet />
                </main>
                <RowMenuLayer palette={commandPalette} drawerOpen={drawerOpen} />
              </div>
              <CommandPalette palette={commandPalette} />
            </div>
          </SelectionProvider>
        </RowMenuProvider>
      </HoverPreviewProvider>
    </SettingsProvider>
  );
}
