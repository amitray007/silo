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
 * clear-filter pill, and tag-specific empty-state copy. The omnibar's OWN
 * inline search is gone (plan 024 — it moved to the command palette, which
 * DOES support a tag-scoped search via `#tag text`); this view's `tagCount`
 * feeds the omnibar's tag-idle "{tagCount} of {libCount}" chip, unrelated to
 * search — that's the tag's own browse-feed count vs. the library total.
 */
export function TagView() {
  const { name } = useParams<{ name: string }>();
  const tag = name ?? '';
  const navigate = useNavigate();
  const view = useListView(tag);

  const header = (
    <ListOmnibar
      omnibar={view.omnibar}
      tagCount={view.links.length}
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
      {...(view.captureError !== undefined ? { captureError: view.captureError } : {})}
      headerSlot={header}
      fadeKey={tag}
    >
      {ListBody(view, <TagEmptyState tag={tag} />)}
    </ContentFrame>
  );
}
