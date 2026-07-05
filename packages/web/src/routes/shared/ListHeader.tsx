import type { ReactNode } from 'react';
import { ContentHeader } from '../../components/ContentHeader';
import { Omnibar } from '../../components/Omnibar';
import type { useOmnibarState } from '../../lib/useOmnibarState';

/**
 * The header (unscrolled, full content width) + scrolling body wrapper
 * shared by every render branch in `LibraryView`/`TagView` (plan 011, V3-2)
 * — `.silo-content-body` is v3's scrolling region (it owns
 * `overflow-y:auto`); `.silo-content-col` inside it caps the reading column
 * at ~720px without introducing a second, nested scroll container.
 * `headerSlot` is the omnibar — always rendered so the header never jumps
 * between render branches.
 */
export function ContentFrame({
  title,
  count,
  enrichingCount,
  captureError,
  headerSlot,
  children,
}: {
  title: ReactNode;
  count: number | undefined;
  enrichingCount?: number;
  captureError?: string;
  headerSlot: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <ContentHeader
        title={title}
        count={count}
        {...(enrichingCount !== undefined ? { enrichingCount } : {})}
        {...(captureError !== undefined ? { captureError } : {})}
      >
        {headerSlot}
      </ContentHeader>
      <div className="silo-content-body">
        <div className="silo-content-col">{children}</div>
      </div>
    </>
  );
}

/**
 * The omnibar bound to `useOmnibarState`, shared by `LibraryView` (no tag
 * filter — `tagName` omitted) and `TagView` (`tagName` set, `onClearTag`
 * navigates back to `/`). `onKeep` (plan 011, V3-3) is `useListView`'s real
 * capture handler — this component no longer owns any capture logic itself,
 * it only wires the callback through so neither view has to repeat it.
 */
export function ListOmnibar({
  omnibar,
  searchEnabled,
  shownCount,
  libCount,
  onKeep,
  tagName,
  onClearTag,
}: {
  omnibar: ReturnType<typeof useOmnibarState>;
  searchEnabled: boolean;
  shownCount: number;
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
      shownCount={searchEnabled ? shownCount : libCount}
      libCount={libCount}
    />
  );
}
