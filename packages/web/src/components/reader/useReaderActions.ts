import { useEffect, useMemo, useState } from 'react';
import { useDeleteNow, useRestoreLink, useTrashLink } from '../../api/hooks';
import type { LinkJson } from '../../api/types';
import { isTextEntryElement } from '../../lib/usePasteCapture';
import { useRowMenu } from '../RowMenuContext';
import { useLibrarySelection, useTrashSelection } from '../SelectionContext';

export function originalUrl(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export function useReaderActions(
  link: LinkJson | undefined,
  trashed: boolean,
  onRemoved: () => void,
) {
  const id = link?.id ?? '';
  const trash = useTrashLink(id);
  const restore = useRestoreLink(id);
  const remove = useDeleteNow(id);
  const librarySelection = useLibrarySelection();
  const trashSelection = useTrashSelection();
  const { openEdit } = useRowMenu();
  const [notice, setNotice] = useState({ id, message: '' });
  const feedback = notice.id === id ? notice.message : '';
  const setFeedback = (message: string) => setNotice({ id, message });
  const busy = trash.isPending || restore.isPending || remove.isPending;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setFeedback('Link copied');
    } catch {
      setFeedback("Couldn't copy the link");
    }
  }

  function act(kind: 'trash' | 'restore' | 'delete') {
    if (!link || busy) return;
    const mutation = { trash, restore, delete: remove }[kind];
    mutation.mutate(undefined, {
      onSuccess: () => {
        (trashed ? trashSelection : librarySelection).deselect([id]);
        onRemoved();
      },
      onError: (error) => setFeedback(error.message),
    });
  }

  return {
    busy,
    feedback,
    copy,
    trash: () => act('trash'),
    restore: () => act('restore'),
    remove: () => act('delete'),
    edit: (focus: 'title' | 'note' | 'tags' = 'title') => link && openEdit(link, focus),
    open: () => {
      const url = link && originalUrl(link.url);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}

export function useReaderKeyboard({
  step,
  close,
  toggleTab,
  actions,
  trashed,
  selected,
}: {
  step: (delta: number) => void;
  close: () => void;
  toggleTab: () => void;
  actions: ReturnType<typeof useReaderActions>;
  trashed: boolean;
  selected: boolean;
}) {
  const { openMenuId } = useRowMenu();
  const commands = useMemo(() => {
    const commands: Record<string, (() => void) | undefined> = {
      j: () => step(1),
      ArrowDown: () => step(1),
      k: () => step(-1),
      ArrowUp: () => step(-1),
    };
    if (selected)
      Object.assign(commands, {
        Escape: close,
        e: () => actions.edit(),
        o: actions.open,
        c: actions.copy,
        r: toggleTab,
      });
    if (selected && !trashed)
      Object.assign(commands, { Backspace: actions.trash, Delete: actions.trash });
    return commands;
  }, [step, close, toggleTab, actions, selected, trashed]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (ignoreReaderKey(event) || openMenuId !== null) return;
      const command = commands[event.key];
      if (!command) return;
      event.preventDefault();
      if (event.key === 'Escape') event.stopImmediatePropagation();
      command();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [commands, openMenuId]);
}

function ignoreReaderKey(event: KeyboardEvent) {
  return (
    event.defaultPrevented ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isTextEntryElement(event.target) ||
    isTextEntryElement(document.activeElement) ||
    Boolean(
      document.querySelector(
        '[role="dialog"], [data-reader-menu], .silo-sidebar[data-open="true"]',
      ),
    )
  );
}
