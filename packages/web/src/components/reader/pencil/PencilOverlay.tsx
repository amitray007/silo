import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { layoutMedia, useMediaQuery } from '../../../lib/breakpoints';
import { ReaderIcon } from '../ReaderIcon';
import type { PencilApi } from './usePencil';

/**
 * The resume button is 24px wide, 6px past the prose and at least 4px inside the pane's edge. On
 * a phone the article's right padding is 20px, so the button shrinks to 20px and fills it.
 */
type Gutter = { size: number; gap: number; edge: number };
const DESKTOP_GUTTER: Gutter = { size: 24, gap: 6, edge: 4 };
const PHONE_GUTTER: Gutter = { size: 20, gap: 0, edge: 0 };

/**
 * Where the right gutter column starts, in the frame's own coordinates: just past the prose,
 * pulled in when the pane is too narrow to leave room. Slice 3's note markers share this column.
 */
function useGutterLeft(
  frame: HTMLElement | null,
  scroll: HTMLElement | null,
  { size, gap, edge }: Gutter,
): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!frame || !scroll) return;
    const place = () => {
      const inset = frame.getBoundingClientRect().left - scroll.getBoundingClientRect().left;
      setLeft(Math.min(frame.clientWidth + gap, scroll.clientWidth - inset - size - edge));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(frame);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [frame, scroll, size, gap, edge]);
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
  const gutter = useMediaQuery(layoutMedia.phone) ? PHONE_GUTTER : DESKTOP_GUTTER;
  const gutterLeft = useGutterLeft(frame, scroll, gutter);
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
