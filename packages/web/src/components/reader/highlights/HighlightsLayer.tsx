import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchSilo } from '../../SearchSiloContext';
import type { NotesLaneApi } from '../notes/useNotesLane';
import { LayersPopover } from './LayersPopover';
import { NotePopover } from './NotePopover';
import { SelectionBar } from './SelectionBar';
import type { HighlightsApi } from './useHighlights';

const NONE: ReadonlySet<string> = new Set();
/** Read aloud speaks English only for now, so other articles get no Listen action. */
const NO_LISTEN: ReadonlySet<string> = new Set(['listen']);

/**
 * What the highlights draw over the article: the selection toolbar, the note popover, and the
 * failure message. The dock mounts it into the pane so Sepia recolours all of it.
 */
export function HighlightsLayer({
  api,
  linkId,
  askReady,
  chatOpen,
  lane,
  title,
  container,
  listen,
}: {
  api: HighlightsApi;
  linkId: string;
  askReady: boolean;
  chatOpen: boolean;
  lane: NotesLaneApi;
  title: string;
  container: HTMLElement;
  /** Read aloud: whether the article can be read, and how to start at the selection. */
  listen: { english: boolean; startHere: () => void };
}) {
  const searchSilo = useSearchSilo();
  const { create, color, openNoteItem, scroll } = api;
  const layered = lane.layers
    ? lane.layers.ids.flatMap((id) => api.resolved.filter((entry) => entry.id === id))
    : [];
  const note = useCallback(() => create(color, { note: true }), [create, color]);
  return (
    <>
      <SelectionBar
        linkId={linkId}
        askReady={askReady}
        chatOpen={chatOpen}
        onSaveAnswer={async (answer) => {
          await create(color, { answer });
        }}
        pending={api.pending}
        prose={api.prose}
        container={container}
        title={title}
        color={color}
        blocked={api.blocked}
        onHighlight={create}
        onPick={api.pick}
        onNote={note}
        onDismiss={api.clearPending}
        onSearch={searchSilo}
        onListen={listen.startHere}
        hidden={listen.english ? NONE : NO_LISTEN}
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
          onClose={lane.closeNote}
          onBack={lane.backTo ? lane.back : undefined}
        />
      )}
      {lane.layers && layered.length > 1 && (
        <LayersPopover
          items={layered}
          at={lane.layers}
          container={container}
          onOpen={lane.openFromLayers}
          onClose={lane.closeLayers}
          onHover={lane.setHoveredIds}
        />
      )}
      {api.error &&
        createPortal(
          <div className="silo-sb-toast silo-highlight-error" role="alert">
            {api.error}
          </div>,
          container,
        )}
    </>
  );
}
