import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

/** One selection scope's public surface — `library` (shared by `LibraryView` + `TagView`, matching v3's single `st.sel` array covering every `view === 'library'` screen) and `trash` each get their own independent instance of this shape. */
export interface SelectionScope {
  /** The currently selected row ids, in no particular order. */
  selected: string[];
  /** True iff `id` is currently selected — the row checkbox's `isSel`. */
  isSelected: (id: string) => boolean;
  /** Toggles `id`'s membership — the row checkbox's `toggleSel`. */
  toggle: (id: string) => void;
  /**
   * Removes exactly `ids` from the selection, leaving everything else
   * selected (review fix, plan 011 V3-5). Used by (a) a bulk dock action's
   * settle, so it clears only the ids IT operated on — NOT any rows the user
   * selected while the batch was in flight (a whole-`clear()` would wipe
   * those too); and (b) a single-row action (restore/delete-now/trash from a
   * row's own button), so a selected row that's individually acted on drops
   * out of the selection instead of leaving a stale, now-rowless id that
   * inflates the dock's "N selected" count. A no-op for ids not currently
   * selected.
   */
  deselect: (ids: string[]) => void;
  /** Replaces the whole selection (the trash dock's "select all"). */
  selectAll: (ids: string[]) => void;
  /** Empties the selection (a dock's "clear", or Esc). */
  clear: () => void;
}

interface SelectionContextValue {
  library: SelectionScope;
  trash: SelectionScope;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

/** Builds one independent `SelectionScope` — a small `useState<Set<string>>` plus the four stable callbacks above. Two of these (never shared) back `library`/`trash` in `SelectionProvider`. */
function useSelectionScope(): SelectionScope {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const deselect = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setSelected((current) => {
      const next = new Set(current);
      let changed = false;
      for (const id of ids) {
        if (next.delete(id)) changed = true;
      }
      // Preserve referential identity when nothing actually changed, so an
      // unrelated deselect can't churn every consumer's render.
      return changed ? next : current;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => setSelected(new Set(ids)), []);
  const clear = useCallback(() => setSelected(new Set()), []);

  return useMemo(
    () => ({ selected: [...selected], isSelected, toggle, deselect, selectAll, clear }),
    [selected, isSelected, toggle, deselect, selectAll, clear],
  );
}

/**
 * Two independent multi-select scopes (plan 011, V3-5) — `library` (shared by
 * `LibraryView` + `TagView`, matching v3's single `st.sel`) and `trash` (its
 * own `st.trSel`), mounted ONCE in `AppFrame` alongside `RowMenuProvider` so
 * neither route has to instantiate its own selection state (the build
 * brief's "lift to a context... so it works across Library + Trash without
 * route duplication"). `RowMenuLayer` reads both scopes to coordinate Esc:
 * closes the row menu first if one is open, otherwise clears whichever
 * scope's dock is currently showing (see `AppFrame.tsx`).
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const library = useSelectionScope();
  const trash = useSelectionScope();

  const value = useMemo(() => ({ library, trash }), [library, trash]);

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

function useSelectionContext(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error(
      'useLibrarySelection/useTrashSelection must be used within a SelectionProvider',
    );
  }
  return context;
}

/** The Library/Tag rows' + selection dock's shared scope. */
export function useLibrarySelection(): SelectionScope {
  return useSelectionContext().library;
}

/** The Trash rows' + selection dock's shared scope. */
export function useTrashSelection(): SelectionScope {
  return useSelectionContext().trash;
}
