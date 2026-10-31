import { createPortal } from 'react-dom';
import { useGutter } from '../gutter';
import { ReaderIcon } from '../ReaderIcon';
import type { PencilApi } from './usePencil';

/** Draws the pencil guide and the resume button in the frame that holds the prose. */
export function PencilOverlay({
  pencil,
  prose,
  scroll,
}: {
  pencil: PencilApi;
  prose: HTMLElement | null;
  scroll: HTMLElement | null;
}) {
  const frame = prose?.parentElement ?? null;
  const { gutter, left: gutterLeft } = useGutter(frame, scroll);
  if (!frame) return null;
  return createPortal(
    <>
      {pencil.enabled && (
        <div className="silo-pencil" data-style={pencil.style} ref={pencil.bindGuide}>
          <div className="silo-pencil-fill" ref={pencil.bindFill} />
        </div>
      )}
      {pencil.resume && (
        <button
          type="button"
          className="silo-resume"
          title="Resume reading (P)"
          aria-label="Resume reading"
          style={{ top: pencil.resume.y - gutter.size / 2, left: gutterLeft }}
          onClick={pencil.start}
        >
          <ReaderIcon name="play" size={12} />
        </button>
      )}
    </>,
    frame,
  );
}
