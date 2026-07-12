import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDeleteTag } from '../api/hooks';
import { HeaderActionButton } from '../components/HeaderActionButton';
import { CheckIcon, TrashIcon } from '../components/NavIcons';
import { PasteCaptureButton } from './LibraryView';
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

/** Confirm-state auto-reset (mirrors TrashView's CONFIRM_RESET_MS). */
const CONFIRM_RESET_MS = 4000;

/**
 * The tag page's "Delete" button — the SAME two-step in-button confirm as
 * `TrashView`'s `TrashEmptyNowButton` (trash icon + "Delete" → first click →
 * check icon + "Confirm?" → second click deletes). Deleting a tag removes it
 * from EVERY link (the links are kept) and is not undoable, so a single tap
 * must never fire it. On success, navigates to the Library (`/`) since this
 * tag's page would otherwise show a dead/empty feed.
 */
function DeleteTagButton({ tag }: { tag: string }) {
  const deleteTag = useDeleteTag();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  function armConfirm() {
    setConfirming(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setConfirming(false), CONFIRM_RESET_MS);
  }

  function handleClick(): undefined {
    if (!confirming) {
      armConfirm();
      return undefined;
    }
    clearTimeout(resetTimer.current);
    deleteTag.mutate(tag, {
      onSuccess: () => navigate('/'),
      onSettled: () => setConfirming(false),
    });
    return undefined;
  }

  return (
    <HeaderActionButton
      icon={confirming ? <CheckIcon /> : <TrashIcon size={16} stroke="currentColor" />}
      label={confirming ? 'Confirm?' : 'Delete'}
      onClick={handleClick}
      disabled={deleteTag.isPending || !tag}
      title={
        confirming
          ? `Confirm deleting the tag "${tag}" from all links`
          : `Delete the tag "${tag}" (removes it from all links; the links are kept)`
      }
      ariaLabel={confirming ? 'Confirm deleting this tag' : 'Delete this tag'}
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

  return (
    <ContentFrame
      title={`# ${tag}`}
      count={view.links.length}
      headerSlot={
        <>
          <DeleteTagButton tag={tag} />
          <PasteCaptureButton tags={[tag]} />
        </>
      }
      fadeKey={tag}
    >
      {ListBody(view, <TagEmptyState tag={tag} />)}
    </ContentFrame>
  );
}
