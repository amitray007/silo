import { createPortal } from 'react-dom';
import type { PencilApi } from './usePencil';

/** Draws the pencil guide in the frame that holds the prose. */
export function PencilOverlay({ pencil, prose }: { pencil: PencilApi; prose: HTMLElement | null }) {
  const frame = prose?.parentElement ?? null;
  if (!frame) return null;
  return createPortal(
    <>
      {pencil.enabled && (
        <div className="silo-pencil" data-style={pencil.style} ref={pencil.bindGuide}>
          <div className="silo-pencil-fill" ref={pencil.bindFill} />
        </div>
      )}
    </>,
    frame,
  );
}
