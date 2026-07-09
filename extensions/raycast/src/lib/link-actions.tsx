import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api';
import { useState } from 'react';
import {
  CaptureError,
  deleteTrashed,
  editNote,
  emptyTrash,
  restoreLink,
  retryLink,
  trashLink,
} from './capture-client.js';
import { AddTagAction, RemoveTagAction } from './tag-picker.js';
import type { CapturedLink } from './types.js';

/** Which action set a result belongs to — a live library link, or one already in the trash (design spec: "the action set swaps Trash→Restore and adds Empty-trash"). */
export type ActionVariant = 'live' | 'trash';

/** Pure action metadata — no Raycast types — so the shortcut/destructive-guard invariants (Task 7's binding rule: destructive actions never bind to `⏎`) are unit-testable without rendering. */
export type ActionSpec = {
  id: string;
  shortcut: 'enter' | string;
  destructive: boolean;
};

const LIVE_ACTIONS: ActionSpec[] = [
  { id: 'open', shortcut: 'enter', destructive: false },
  { id: 'copy', shortcut: 'cmd+c', destructive: false },
  { id: 'edit-note', shortcut: 'cmd+e', destructive: false },
  { id: 'add-tag', shortcut: 'cmd+t', destructive: false },
  { id: 'remove-tag', shortcut: 'cmd+shift+t', destructive: false },
  { id: 'retry', shortcut: 'cmd+r', destructive: false },
  { id: 'filter-tag', shortcut: 'cmd+f', destructive: false },
  { id: 'trash', shortcut: 'ctrl+x', destructive: true },
];

// Order matches the rendered panel: Restore is primary (⏎), then Open/Copy,
// then the guarded destructive actions. Only ONE action carries 'enter'.
const TRASH_ACTIONS: ActionSpec[] = [
  { id: 'restore', shortcut: 'enter', destructive: false },
  { id: 'open', shortcut: 'default', destructive: false },
  { id: 'copy', shortcut: 'cmd+c', destructive: false },
  { id: 'delete', shortcut: 'ctrl+x', destructive: true },
  { id: 'empty-trash', shortcut: 'cmd+shift+delete', destructive: true },
];

/** The action set for a variant, in display order — the source of truth both the test and `LinkActions` build from. */
export function actionsFor(variant: ActionVariant): ActionSpec[] {
  return variant === 'live' ? LIVE_ACTIONS : TRASH_ACTIONS;
}

async function runGuarded(
  action: () => Promise<unknown>,
  successTitle: string,
  onChange: () => void,
): Promise<void> {
  try {
    await action();
    await showToast({ style: Toast.Style.Success, title: successTitle });
    onChange();
  } catch (error) {
    const message = error instanceof CaptureError ? error.message : 'silo request failed';
    await showToast({ style: Toast.Style.Failure, title: message });
  }
}

type LinkActionsProps = {
  link: CapturedLink;
  variant: ActionVariant;
  /** Called after any successful write, so the caller re-fetches / updates local state. */
  onChange: () => void;
  /** Called after edit-note/add-tag/remove-tag with the updated link, so the row reflects the change immediately. */
  onLinkUpdated?: (updated: CapturedLink) => void;
  /** Browse's "Filter by tag" hook — sets the scope dropdown to a tag. Absent in Search (no scope concept). */
  onFilterTag?: (tag: string) => void;
};

/** The shared `⌘K` action panel for Search + Browse (live and trash variants — design spec's "Action set"). */
export function LinkActions({
  link,
  variant,
  onChange,
  onLinkUpdated,
  onFilterTag,
}: LinkActionsProps) {
  const { pop } = useNavigation();
  const handleUpdated = onLinkUpdated ?? (() => {});

  async function confirmAndRun(
    title: string,
    message: string,
    action: () => Promise<unknown>,
    successTitle: string,
  ): Promise<void> {
    const confirmed = await confirmAlert({
      title,
      message,
      primaryAction: { title, style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    await runGuarded(action, successTitle, onChange);
  }

  if (variant === 'trash') {
    return (
      <ActionPanel>
        {/* Restore is the primary action in trash, so it renders FIRST and
            Raycast binds ⏎ to it — matching the design spec ("⏎ = Restore").
            Open/Copy follow as secondary. */}
        <Action
          title="Restore"
          icon={Icon.ArrowCounterClockwise}
          onAction={() => void runGuarded(() => restoreLink(link.id), 'Restored', onChange)}
        />
        <Action.OpenInBrowser url={link.url} title="Open in Browser" />
        <Action.CopyToClipboard content={link.url} title="Copy URL" icon={Icon.CopyClipboard} />
        <Action
          title="Delete Permanently"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ['ctrl'], key: 'x' }}
          onAction={() =>
            void confirmAndRun(
              'Delete Permanently',
              `Permanently delete "${link.title ?? link.url}"? This cannot be undone.`,
              () => deleteTrashed(link.id),
              'Deleted',
            )
          }
        />
        <Action
          title="Empty Trash"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ['cmd', 'shift'], key: 'delete' }}
          onAction={() =>
            void confirmAndRun(
              'Empty Trash',
              'Permanently delete everything in trash? This cannot be undone.',
              () => emptyTrash(),
              'Trash emptied',
            )
          }
        />
      </ActionPanel>
    );
  }

  return (
    <ActionPanel>
      <Action.OpenInBrowser url={link.url} title="Open in Browser" />
      <Action.CopyToClipboard content={link.url} title="Copy URL" icon={Icon.CopyClipboard} />
      <Action.Push
        title="Edit Note…"
        icon={Icon.Pencil}
        shortcut={{ modifiers: ['cmd'], key: 'e' }}
        target={
          <EditNoteForm
            link={link}
            onDone={(updated) => {
              handleUpdated(updated);
              onChange();
              pop();
            }}
          />
        }
      />
      <AddTagAction
        link={link}
        onDone={(updated) => {
          handleUpdated(updated);
          onChange();
        }}
      />
      <RemoveTagAction
        link={link}
        onDone={(updated) => {
          handleUpdated(updated);
          onChange();
        }}
      />
      <Action
        title="Retry Enrichment"
        icon={Icon.ArrowClockwise}
        shortcut={{ modifiers: ['cmd'], key: 'r' }}
        onAction={() => void runGuarded(() => retryLink(link.id), 'Retrying', onChange)}
      />
      {onFilterTag && link.tags.length > 0 && (
        <Action
          title="Filter by Tag"
          icon={Icon.Filter}
          shortcut={{ modifiers: ['cmd'], key: 'f' }}
          onAction={() => onFilterTag(link.tags[0] as string)}
        />
      )}
      <Action
        title="Move to Trash"
        icon={Icon.Trash}
        style={Action.Style.Destructive}
        shortcut={{ modifiers: ['ctrl'], key: 'x' }}
        onAction={() =>
          void confirmAndRun(
            'Move to Trash',
            `Move "${link.title ?? link.url}" to trash?`,
            () => trashLink(link.id),
            'Moved to trash',
          )
        }
      />
    </ActionPanel>
  );
}

/** The `⌘E` edit-note form — a plain replace (matches `PATCH /api/links/:id { note }`'s semantics), not a merge/append. */
function EditNoteForm({
  link,
  onDone,
}: {
  link: CapturedLink;
  onDone: (updated: CapturedLink) => void;
}) {
  const [note, setNote] = useState(link.notes ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {
    setIsSubmitting(true);
    try {
      const updated = await editNote(link.id, note);
      await showToast({ style: Toast.Style.Success, title: 'Note saved' });
      onDone(updated);
    } catch (error) {
      const message = error instanceof CaptureError ? error.message : 'Could not save note';
      await showToast({ style: Toast.Style.Failure, title: message });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Note" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea id="note" title="Note" value={note} onChange={setNote} />
    </Form>
  );
}
