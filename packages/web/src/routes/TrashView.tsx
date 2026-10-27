import { useState } from 'react';
import { useCounts, useDeleteNow, useEmptyTrash, useTrashList } from '../api/hooks';
import type { TrashLinkJson } from '../api/types';
import { ContentHeader } from '../components';
import { CenteredPanel } from '../components/CenteredPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DeleteForeverDialog } from '../components/DeleteForeverDialog';
import { TrashIcon } from '../components/NavIcons';
import { ReaderLayout } from '../components/reader/ReaderLayout';
import { TrashDayGroup } from '../components/TrashDayGroup';
import { bucketTrashByDay } from '../lib/buckets';
import { LoadingState } from './shared/ListStates';

function TrashEmptyNowButton() {
  const emptyTrash = useEmptyTrash();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button
        type="button"
        className="silo-reader-btn silo-empty-trash"
        onClick={() => setConfirming(true)}
        disabled={emptyTrash.isPending}
        title="Permanently empty the trash"
        aria-label="Empty trash"
      >
        <TrashIcon size={16} stroke="currentColor" />
        Empty trash
      </button>
      {confirming && (
        <ConfirmDialog
          title="Empty trash?"
          item="All links in trash"
          action="Empty trash"
          actionLabel="Confirm emptying the trash"
          pending={emptyTrash.isPending}
          onClose={() => setConfirming(false)}
          onConfirm={() => emptyTrash.mutate(undefined, { onSettled: () => setConfirming(false) })}
        >
          All links in trash will be deleted forever. This cannot be undone.
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * The trash empty state — a proper centered composition (user feedback:
 * "add a better empty state for trash"), matching the Library's rich
 * `EmptyState` shell (`CenteredPanel` + mark + headline + body) rather than
 * the previous bare left-aligned line. Uses the trash-can mark (a permitted
 * icon) instead of the grain dot, and the body explains the auto-empty
 * behavior so an empty trash reads as reassuring, not blank.
 */
function TrashEmptyState({ purgeWindowDays }: { purgeWindowDays: number }) {
  return (
    <CenteredPanel empty>
      <span style={{ color: 'var(--fnt)', display: 'inline-flex' }}>
        <TrashIcon size={26} stroke="currentColor" />
      </span>
      <p
        style={{
          margin: 'var(--s5) 0 0',
          fontSize: 'var(--text-md)',
          fontWeight: 600,
          color: 'var(--ink)',
          letterSpacing: 'var(--tracking-tight)',
          textWrap: 'balance',
        }}
      >
        Trash is empty
      </p>
      <p
        style={{
          margin: 'var(--s1-5) 0 0',
          fontSize: 'var(--text-sm)',
          color: 'var(--mut)',
          maxWidth: '30ch',
          lineHeight: 'var(--lh-snug)',
          textWrap: 'pretty',
        }}
      >
        Deleted links stay here for {purgeWindowDays} days.
      </p>
    </CenteredPanel>
  );
}

/**
 * The Trash body's loading/error/empty/results branches — pulled out of
 * `TrashView` itself so that component's own complexity stays under the lint
 * gate. Search removed (later user-feedback pass, mirroring the Library's own
 * omnibar-search removal): the header's search input is gone — trash search
 * now lives entirely in the command palette (⌘K / `/`) — so this only ever
 * renders the plain day-grouped browse feed.
 */
function TrashBody({
  loading,
  isError,
  shownLinks,
  purgeWindowDays,
  onDelete,
}: {
  loading: boolean;
  isError: boolean;
  shownLinks: TrashLinkJson[];
  purgeWindowDays: number;
  onDelete: (id: string) => void;
}) {
  // Reuse the shared list `LoadingState` (Library/Tag) — Trash is also
  // day-grouped (`TrashDayGroup` → the same `DayGroupHeading`) and `TrashRow`
  // shares `.silo-link-row`'s exact 10px padding / 12px gap / 18px favicon
  // anatomy (the K3 oat-conformance alignment), so the same CLS-correct
  // heading+row skeleton fits Trash with no drift — no reason to hand-roll a
  // second, different loader here (the old flat blocks it replaces did drift).
  if (loading) {
    return <LoadingState />;
  }

  if (isError) {
    return (
      <p
        style={{
          padding: '40px 11px',
          margin: 0,
          fontSize: 'var(--text-sm)',
          color: 'var(--warn)',
        }}
      >
        Couldn't load the trash.
      </p>
    );
  }

  if (shownLinks.length === 0) {
    return <TrashEmptyState purgeWindowDays={purgeWindowDays} />;
  }

  return (
    <>
      {bucketTrashByDay(shownLinks).map((group) => (
        <TrashDayGroup
          key={group.label}
          label={group.label}
          links={group.items}
          purgeWindowDays={purgeWindowDays}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

/** Trash keeps its list, per-link actions, and purge policy beside the shared reader. */
export function TrashView() {
  const { data: counts } = useCounts();
  const { data, isLoading, isError } = useTrashList();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const remove = useDeleteNow();

  const links = data?.links ?? [];
  const purgeWindowDays = counts?.purgeWindowDays ?? 30;
  return (
    <ReaderLayout
      links={links}
      loading={isLoading}
      title="Trash"
      trashed
      purgeWindowDays={purgeWindowDays}
    >
      <ContentHeader collection title="Trash" count={counts?.trash}>
        {links.length > 0 && <TrashEmptyNowButton />}
      </ContentHeader>
      <div className="silo-content-body">
        <div className="silo-content-col silo-route-fade">
          <TrashBody
            loading={isLoading}
            isError={isError}
            shownLinks={links}
            purgeWindowDays={purgeWindowDays}
            onDelete={setDeleteId}
          />
        </div>
      </div>

      {deleteId && (
        <DeleteForeverDialog
          link={links.find((link) => link.id === deleteId)}
          pending={remove.isPending}
          onClose={() => setDeleteId(null)}
          onConfirm={() =>
            remove.mutate(deleteId, {
              onSettled: () => setDeleteId(null),
            })
          }
        />
      )}
    </ReaderLayout>
  );
}
