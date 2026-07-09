import { useParams } from 'react-router-dom';
import { ListBody } from './shared/ListBodies';
import { ContentFrame } from './shared/ListHeader';
import { EmptyState } from './shared/ListStates';
import { useListView } from './shared/useListView';

/** `/tags/:name`'s empty state copy — distinct from the Library's "nothing kept yet at all" (this tag specifically has no live links, not the whole store). */
function TagEmptyState({ tag }: { tag: string }) {
  return (
    <EmptyState
      title={`No links tagged # ${tag} yet.`}
      body="Tag a link from its ⋯ menu, or paste one here — it'll pick up this tag once you assign it."
    />
  );
}

/**
 * `/tags/:name` — a tag-scoped Library view (plan 011, V3-2; superseding the
 * `ComingSoon` placeholder from W5). Reuses the exact same orchestration
 * (`useListView(tag)`) and header/body/state chrome as `LibraryView`
 * (`./shared/*`) — the only real differences are: the tag scope on the
 * browse feed, the header title (`# {name}`), and tag-specific empty-state
 * copy.
 *
 * The header's `ListOmnibar` (the "Paste a link to keep" bar + its `#tag ✕`
 * pill) is DELIBERATELY OMITTED here (bugfix, user report: the tag page
 * showed a search-icon input carrying the SAME `#{tag}` the page title
 * already states, reading as a redundant search box). `ContentFrame`'s
 * `headerSlot` is left `undefined` so the header renders title+count only,
 * matching `TrashView`'s/`SettingsView`'s own "no children" convention
 * (`ContentHeader`'s doc comment: an omitted slot renders nothing, not a
 * phantom placeholder box). This does NOT remove capture-from-a-tag-page:
 * `usePasteCapture` (mounted once in `AppFrame`) captures a pasted URL
 * anywhere on the page regardless of which route is active, and search is
 * now exclusively the command palette's job (⌘K / `/`) — scoped ONLY to
 * `TagView`; `LibraryView`/`TrashView` keep their own headers untouched.
 */
export function TagView() {
  const { name } = useParams<{ name: string }>();
  const tag = name ?? '';
  const view = useListView(tag);

  return (
    <ContentFrame title={`# ${tag}`} count={view.links.length} headerSlot={undefined} fadeKey={tag}>
      {ListBody(view, <TagEmptyState tag={tag} />)}
    </ContentFrame>
  );
}
