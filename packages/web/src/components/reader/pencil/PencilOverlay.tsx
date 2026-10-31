import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ReaderIcon } from '../ReaderIcon';
import type { PencilApi } from './usePencil';

/** The resume button is 24px wide; keep it 4px inside the pane's edge. */
const RESUME_SIZE = 24;
const GUTTER_GAP = 6;
const EDGE_GAP = 4;

/**
 * Where the right gutter column starts, in the frame's own coordinates: just past the prose,
 * pulled in when the pane is too narrow to leave room. Slice 3's note markers share this column.
 */
function useGutterLeft(frame: HTMLElement | null, scroll: HTMLElement | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!frame || !scroll) return;
    const place = () => {
      const inset = frame.getBoundingClientRect().left - scroll.getBoundingClientRect().left;
      setLeft(
        Math.min(
          frame.clientWidth + GUTTER_GAP,
          scroll.clientWidth - inset - RESUME_SIZE - EDGE_GAP,
        ),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(frame);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [frame, scroll]);
  return left;
}

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
  const gutterLeft = useGutterLeft(frame, scroll);
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
          style={{ top: pencil.resume.y - RESUME_SIZE / 2, left: gutterLeft }}
          onClick={pencil.start}
        >
          <ReaderIcon name="play" size={12} />
        </button>
      )}
    </>,
    frame,
  );
}
