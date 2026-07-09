import { ListBody } from './shared/ListBodies';
import { ContentFrame } from './shared/ListHeader';
import { EmptyState } from './shared/ListStates';
import { useListView } from './shared/useListView';

/** `/`'s empty state copy — "nothing kept yet at all" (distinct from `TagView`'s per-tag empty copy). */
function LibraryEmptyState() {
  return (
    <EmptyState
      title="Nothing kept yet."
      body={
        <>
          Paste a link anywhere on this page — it's saved the moment it lands.
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
 * `/` — the Library list (plan 010; the omnibar's live search that plan 011
 * V3-2 added here has since moved OUT to the command palette, plan 024 —
 * this view is just the day-grouped browse feed now). Read-only rows via
 * `useListView()` (no tag scope), with pagination (the "load more" button +
 * prefetch sentinel). Shares its orchestration/header/body/state chrome with
 * `TagView` via `./shared/*` — see those modules' doc comments.
 *
 * The header carries only the title now — the "Paste a link to keep"
 * hint box was removed (direct user feedback: match shiori's compact header,
 * which has no top input). Capture still works everywhere: pasting a URL
 * anywhere on the page captures it via the document-level `usePasteCapture`
 * listener (mounted once in `AppFrame`).
 */
export function LibraryView() {
  const view = useListView();

  return (
    <ContentFrame title="Library" headerSlot={undefined}>
      {ListBody(view, <LibraryEmptyState />)}
    </ContentFrame>
  );
}
