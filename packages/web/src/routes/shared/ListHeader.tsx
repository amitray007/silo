import type { ReactNode } from 'react';
import { useBulkTrash } from '../../api/hooks';
import { ContentHeader } from '../../components/ContentHeader';
import { DockIconAction, DockTrashIcon, SelectionDock } from '../../components/Dock';
import { Omnibar } from '../../components/Omnibar';
import { useLibrarySelection } from '../../components/SelectionContext';
import type { useOmnibarState } from '../../lib/useOmnibarState';

/**
 * The Library selection dock (v3's `selActive`, `Silo-v3.html:279-287`) — "N
 * selected · move to trash · clear · esc". Shared by `LibraryView`/`TagView`
 * via `ContentFrame` below (both use the SAME `useLibrarySelection()` scope,
 * matching v3's single `st.sel` array covering every `view === 'library'`
 * screen — selecting a row in `#mcp` and switching to the plain Library still
 * shows it selected, exactly like v3). "move to trash" loops
 * `POST /api/links/:id/trash` per selected id via `useBulkTrash` (`runBulk`,
 * `api/hooks.ts`) since there's no bulk API, then deselects exactly the ids IT
 * batched on settle — `deselect(batch)`, NOT a whole `clear()`, so a row
 * selected WHILE the batch is in flight survives (review fix). A partial
 * failure just leaves that row un-trashed, which the invalidate-driven
 * refetch reconciles. The button is disabled while the batch is pending so a
 * double-click can't fire a second overlapping batch.
 */
function LibrarySelectionDock({ selectedIds }: { selectedIds: string[] }) {
  const selection = useLibrarySelection();
  const bulkTrash = useBulkTrash();

  const handleTrash = () => {
    if (bulkTrash.isPending) return;
    const batch = selectedIds;
    bulkTrash.mutate(batch, { onSettled: () => selection.deselect(batch) });
  };

  return (
    <SelectionDock selectedCount={selectedIds.length} onClear={selection.clear}>
      <DockIconAction onClick={handleTrash} icon={<DockTrashIcon />} disabled={bulkTrash.isPending}>
        Move to trash
      </DockIconAction>
    </SelectionDock>
  );
}

/**
 * The header (unscrolled, full content width) + scrolling body wrapper
 * shared by every render branch in `LibraryView`/`TagView` (plan 011, V3-2;
 * the selection dock added V3-5) — `.silo-content-body` is v3's scrolling
 * region (it owns `overflow-y:auto`); `.silo-content-col` inside it caps the
 * reading column at ~720px without introducing a second, nested scroll
 * container. `headerSlot` is the omnibar — always rendered so the header
 * never jumps between render branches. The selection dock renders here
 * (rather than duplicated in both routes) since both routes share the same
 * `ContentFrame` call and the same library selection scope.
 */
export function ContentFrame({
  title,
  count,
  captureError,
  headerSlot,
  children,
  fadeKey,
}: {
  title: ReactNode;
  count: number | undefined;
  captureError?: string;
  headerSlot: ReactNode;
  children: ReactNode;
  /**
   * Keys the `.silo-route-fade` wrapper so its `@starting-style` entrance
   * re-fires on navigations that DON'T remount this component. Library↔Tag
   * swaps different component types (natural remount → fade fires), but
   * Tag→Tag (`/tags/foo`→`/tags/bar`) renders the SAME `TagView` at the same
   * `<Outlet/>` position, so React reconciles the node and the fade would be
   * silently skipped. Passing the tag name here forces a fresh node per tag
   * so tag→tag fades like every other route change (review finding).
   */
  fadeKey?: string;
}) {
  const selection = useLibrarySelection();
  const selectedIds = selection.selected;

  return (
    <>
      <ContentHeader
        title={title}
        count={count}
        {...(captureError !== undefined ? { captureError } : {})}
      >
        {headerSlot}
      </ContentHeader>
      <div className="silo-content-body">
        <div key={fadeKey} className="silo-content-col silo-route-fade">
          {children}
        </div>
      </div>
      {selectedIds.length > 0 && <LibrarySelectionDock selectedIds={selectedIds} />}
    </>
  );
}

/**
 * The omnibar bound to `useOmnibarState`, shared by `LibraryView` (no tag
 * filter — `tagName` omitted) and `TagView` (`tagName` set, `onClearTag`
 * navigates back to `/`). `onKeep` (plan 011, V3-3) is `useListView`'s real
 * capture handler — this component no longer owns any capture logic itself,
 * it only wires the callback through so neither view has to repeat it.
 *
 * Paste-only (plan 024): no `searchEnabled`/`shownCount` — the omnibar no
 * longer has an inline search mode. `tagCount`/`libCount` still feed the
 * tag-idle "{tagCount} of {libCount}" chip (unrelated to search — that's
 * tag-scoped BROWSING via `/tags/:name`, which stays); `LibraryView` (no
 * tag filter) passes `tagCount={0}` since `Omnibar` never reads it without
 * an active `tagName`.
 */
export function ListOmnibar({
  omnibar,
  tagCount,
  libCount,
  onKeep,
  tagName,
  onClearTag,
}: {
  omnibar: ReturnType<typeof useOmnibarState>;
  tagCount: number;
  libCount: number;
  onKeep: () => void;
  tagName?: string;
  onClearTag?: () => void;
}) {
  return (
    <Omnibar
      ref={omnibar.inputRef}
      value={omnibar.q}
      onChange={omnibar.setQ}
      onKeep={onKeep}
      focused={omnibar.focused}
      onFocus={omnibar.onFocus}
      onBlur={omnibar.onBlur}
      looksLikeUrl={omnibar.isUrl}
      {...(tagName !== undefined ? { tagName } : {})}
      onClearTag={onClearTag ?? (() => {})}
      tagCount={tagCount}
      libCount={libCount}
    />
  );
}
