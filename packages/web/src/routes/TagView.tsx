import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useDeleteTag, useTags } from '../api/hooks';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { HeaderActionButton } from '../components/HeaderActionButton';
import { TrashIcon } from '../components/NavIcons';
import { PasteCaptureButton } from '../components/PasteCaptureButton';
import { ReaderLayout } from '../components/reader/ReaderLayout';
import { ListBody } from './shared/ListBodies';
import { ContentFrame } from './shared/ListHeader';
import { EmptyState } from './shared/ListStates';
import { useListView } from './shared/useListView';

/** `/tags/:name`'s empty state copy — distinct from the Library's "nothing kept yet at all" (this tag specifically has no live links, not the whole store). */
function TagEmptyState({ tag }: { tag: string }) {
  return <EmptyState title={`No links tagged #${tag}`} body="Tag a link to see it here." />;
}

/** Confirm tag removal while keeping every link in the library. */
function DeleteTagButton({ tag }: { tag: string }) {
  const deleteTag = useDeleteTag();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <HeaderActionButton
        icon={<TrashIcon size={16} stroke="currentColor" />}
        label="Delete"
        onClick={() => {
          setConfirming(true);
          return undefined;
        }}
        disabled={deleteTag.isPending || !tag}
        title={`Delete the tag "${tag}" (the links are kept)`}
        ariaLabel="Delete this tag"
      />
      {confirming && (
        <ConfirmDialog
          title="Delete tag?"
          item={`#${tag}`}
          action="Delete tag"
          actionLabel="Confirm deleting this tag"
          pending={deleteTag.isPending}
          onClose={() => setConfirming(false)}
          onConfirm={() =>
            deleteTag.mutate(tag, {
              onSuccess: () => navigate('/'),
              onSettled: () => setConfirming(false),
            })
          }
        >
          The tag #{tag} will be removed from all links. Your links will be kept.
        </ConfirmDialog>
      )}
    </>
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
 * already states, reading as a redundant search box). Search is now
 * exclusively the command palette's job (⌘K / `/`) — scoped ONLY to
 * `TagView`; `LibraryView`/`TrashView` keep their own headers untouched.
 *
 * `headerSlot` (method file "tag-capture-empty-trash", decision 3) DOES
 * carry the same `PasteCaptureButton` `LibraryView` uses, here passed
 * `tags={[tag]}` — so the tag page's Add button (and its clipboard-paste
 * path) applies the CURRENT tag to whatever it captures, landing the new
 * link directly in this tag's own feed rather than only the untagged
 * Library. `usePasteCapture` (mounted once in `AppFrame`) does the
 * equivalent for a real Cmd+V paste on this route — see that hook's
 * `currentTag` param.
 */
export function TagView() {
  const { name } = useParams<{ name: string }>();
  const tag = name ?? '';
  const view = useListView(tag);
  const { data } = useTags();
  const count = data?.tags.find((entry) => entry.name === tag)?.count;

  return (
    <ReaderLayout
      links={view.links}
      loading={view.isLoading}
      title={`# ${tag}`}
      hasNextPage={Boolean(view.hasNextPage)}
      fetchNextPage={view.fetchNextPage}
    >
      <ContentFrame
        title={`# ${tag}`}
        count={count}
        headerSlot={
          <>
            <PasteCaptureButton tags={[tag]} />
            <DeleteTagButton tag={tag} />
          </>
        }
        fadeKey={tag}
      >
        {ListBody(view, <TagEmptyState tag={tag} />)}
      </ContentFrame>
    </ReaderLayout>
  );
}
