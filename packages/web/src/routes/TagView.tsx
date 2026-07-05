import { useNavigate, useParams } from 'react-router-dom';
import { ListBody } from './shared/ListBodies';
import { ContentFrame, ListOmnibar } from './shared/ListHeader';
import { EmptyState } from './shared/ListStates';
import { useListView } from './shared/useListView';

/** `/tags/:name`'s empty state copy — distinct from the Library's "nothing kept yet at all" (this tag specifically has no live links, not the whole store). */
function TagEmptyState({ tag }: { tag: string }) {
  return (
    <EmptyState
      title={`No links tagged #${tag} yet.`}
      body="Tag a link from its ⋯ menu, or paste one here — it'll pick up this tag once you assign it."
    />
  );
}

/**
 * `/tags/:name` — a tag-scoped Library view (plan 011, V3-2; superseding the
 * `ComingSoon` placeholder from W5). Reuses the exact same orchestration
 * (`useListView(tag)`) and header/body/state chrome as `LibraryView`
 * (`./shared/*`) — the only real differences are: the tag scope on the
 * browse feed, the header title (`#{name}`), the omnibar's `#{name} ✕`
 * clear-filter pill, and tag-specific empty-state copy. Search (the
 * omnibar's `omniIsSearch` state) is NOT tag-scoped in this slice — same as
 * `LibraryView`, it queries the global `/api/links/search`, matching v3
 * (search re-filters the already-loaded list rather than being a second,
 * tag-aware endpoint).
 */
export function TagView() {
  const { name } = useParams<{ name: string }>();
  const tag = name ?? '';
  const navigate = useNavigate();
  const view = useListView(tag);

  const header = (
    <ListOmnibar
      omnibar={view.omnibar}
      searchEnabled={view.searchEnabled}
      shownCount={view.searchEnabled ? view.results.length : view.links.length}
      libCount={view.liveCount ?? 0}
      onKeep={view.onKeep}
      tagName={tag}
      onClearTag={() => navigate('/')}
    />
  );

  return (
    <ContentFrame
      title={`#${tag}`}
      count={view.links.length}
      enrichingCount={view.enrichingCount}
      {...(view.captureError !== undefined ? { captureError: view.captureError } : {})}
      headerSlot={header}
    >
      {ListBody(view, <TagEmptyState tag={tag} />)}
    </ContentFrame>
  );
}
