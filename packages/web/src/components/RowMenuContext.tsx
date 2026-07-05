import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import type { LinkJson } from '../api/types';

interface RowMenuContextValue {
  /** The id of the row whose `⋯` menu is currently open, or `null` if none is. Only one row's menu is ever open at a time (v3's `menuId`). */
  openMenuId: string | null;
  /** Opens `id`'s menu (closing any other), or closes it if it's already the one open — the `⋯` button's toggle behavior. */
  toggleMenu: (id: string) => void;
  /** Closes whichever menu is open. A no-op if none is. */
  closeMenu: () => void;
  /** The link currently open in the edit modal, or `null` when the modal is closed. */
  editingLink: LinkJson | null;
  /** Opens the edit modal for `link` (and closes the row menu, matching v3's `editFn`: `menuId: null` + `openEdit`). */
  openEdit: (link: LinkJson) => void;
  /** Closes the edit modal without saving. */
  closeEdit: () => void;
}

const RowMenuContext = createContext<RowMenuContextValue | null>(null);

/**
 * Shared row-menu + edit-modal state (plan 011, V3-4) — lifted to ONE
 * provider (mounted once in `AppFrame`, wrapping the routed `<Outlet/>`) so
 * `LibraryView`/`TagView`/`DayGroup`/`LinkRow` all see the same "which row's
 * `⋯` menu is open" / "which link is being edited" state without either route
 * duplicating it (the build brief's explicit "no route dup" constraint —
 * `jscpd` guards production src at 1.5%). Mirrors v3's single `menuId`/
 * `editId` fields on the one root component: opening a menu or the edit modal
 * for one link implicitly closes any other row's menu, and opening the edit
 * modal closes the row menu it was triggered from (v3's `editFn`).
 */
export function RowMenuProvider({ children }: { children: ReactNode }) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editingLink, setEditingLink] = useState<LinkJson | null>(null);

  const toggleMenu = useCallback((id: string) => {
    setOpenMenuId((current) => (current === id ? null : id));
  }, []);

  const closeMenu = useCallback(() => setOpenMenuId(null), []);

  const openEdit = useCallback((link: LinkJson) => {
    setOpenMenuId(null);
    setEditingLink(link);
  }, []);

  const closeEdit = useCallback(() => setEditingLink(null), []);

  const value = useMemo(
    () => ({ openMenuId, toggleMenu, closeMenu, editingLink, openEdit, closeEdit }),
    [openMenuId, toggleMenu, closeMenu, editingLink, openEdit, closeEdit],
  );

  return <RowMenuContext.Provider value={value}>{children}</RowMenuContext.Provider>;
}

export function useRowMenu(): RowMenuContextValue {
  const context = useContext(RowMenuContext);
  if (!context) {
    throw new Error('useRowMenu must be used within a RowMenuProvider');
  }
  return context;
}
