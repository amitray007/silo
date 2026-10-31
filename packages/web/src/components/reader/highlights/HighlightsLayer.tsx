import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchSilo } from '../../SearchSiloContext';
import { NotePopover } from './NotePopover';
import { SelectionBar } from './SelectionBar';
import type { HighlightsApi } from './useHighlights';

/**
 * What the highlights draw over the article: the selection toolbar, the note popover, and the
 * failure message. The dock mounts it into the pane so Sepia recolours all of it.
 */
export function HighlightsLayer({
  api,
  title,
  container,
}: {
  api: HighlightsApi;
  title: string;
  container: HTMLElement;
}) {
  const searchSilo = useSearchSilo();
  const { create, color, openNoteItem, closeNote, scroll } = api;
  const note = useCallback(() => create(color, true), [create, color]);
  return (
    <>
      <SelectionBar
        pending={api.pending}
        prose={api.prose}
        container={container}
        title={title}
        color={color}
        onHighlight={create}
        onNote={note}
        onDismiss={api.clearPending}
        onSearch={searchSilo}
      />
      {openNoteItem && scroll && (
        <NotePopover
          key={api.openNote ?? openNoteItem.id}
          item={openNoteItem}
          all={api.resolved}
          scroll={scroll}
          container={container}
          onRecolor={api.recolor}
          onSetNote={api.setNote}
          onDelete={api.remove}
          onClose={closeNote}
        />
      )}
      {api.error &&
        createPortal(
          <div className="silo-toast silo-highlight-error" role="alert">
            {api.error}
          </div>,
          container,
        )}
    </>
  );
}
