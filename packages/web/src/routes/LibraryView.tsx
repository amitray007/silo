import { ListBody } from './shared/ListBodies';
import { ContentFrame, ListOmnibar } from './shared/ListHeader';
import { EmptyState } from './shared/ListStates';
import { useListView } from './shared/useListView';

/** `/`'s empty state copy — "nothing kept yet at all" (distinct from `TagView`'s per-tag empty copy). */
function LibraryEmptyState() {
  return (
    <EmptyState
      title="Nothing kept yet."
      body={
        <>
          Paste a link in the bar above — it's saved the moment it lands.
          <br />
          <span style={{ fontSize: '0.9em', color: 'var(--fnt)' }}>
            Claude can add links here too, once you connect it in Settings → Access.
          </span>
        </>
      }
    />
  );
}

/**
 * `/` — the Library list (plan 010, extended by plan 011 V3-2 with the
 * omnibar's live search). Day-grouped, read-only rows via `useListView()`
 * (no tag scope); when the omnibar carries a non-empty, non-URL query, the
 * body switches to the search results (`ListBody`). Pagination (the "load
 * more" button + prefetch sentinel) is Library-only — search results aren't
 * paginated in this slice (matches v3, which searches the already-loaded
 * list). Shares its orchestration/header/body/state chrome with `TagView`
 * via `./shared/*` — see those modules' doc comments.
 */
export function LibraryView() {
  const view = useListView();

  const header = (
    <ListOmnibar
      omnibar={view.omnibar}
      searchEnabled={view.searchEnabled}
      shownCount={view.searchEnabled ? view.results.length : view.links.length}
      libCount={view.liveCount ?? 0}
      onKeep={view.onKeep}
    />
  );

  return (
    <ContentFrame
      title="Library"
      count={view.liveCount}
      {...(view.captureError !== undefined ? { captureError: view.captureError } : {})}
      headerSlot={header}
    >
      {ListBody(view, <LibraryEmptyState />)}
    </ContentFrame>
  );
}
