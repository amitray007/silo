import { createPortal } from 'react-dom';
import type { Gutter } from '../gutter';
import { ReaderIcon } from '../ReaderIcon';
import type { NoteGroup } from './useGroups';
import type { NotesLaneApi } from './useNotesLane';

/** Markers within this many pixels of the resume button's centre share its line. */
const CLEARANCE = 4;

/**
 * One note marker per paragraph, in the gutter column the resume button uses (the same x). A
 * marker that would sit on the resume button's line moves down one line of its paragraph.
 */
export function GutterMarkers({
  frame,
  groups,
  frameTop,
  gutter,
  left,
  resumeY,
  lane,
  hidden,
}: {
  frame: HTMLElement;
  groups: readonly NoteGroup[];
  frameTop: number;
  gutter: Gutter;
  left: number;
  /** The resume button's centre, in the frame's coordinates; null when there is none. */
  resumeY: number | null;
  lane: NotesLaneApi;
  /** The lane is an overlay panel: the markers step aside. */
  hidden: boolean;
}) {
  if (groups.length === 0) return null;
  const clear = gutter.size + CLEARANCE;
  return createPortal(
    <>
      {groups.map((group) => {
        const ids = group.items.map((item) => item.id);
        const count = ids.length;
        let y = group.y - frameTop;
        if (resumeY !== null && Math.abs(y - resumeY) < clear)
          y += Math.ceil(clear / group.lineHeight) * group.lineHeight;
        return (
          <button
            key={group.para}
            type="button"
            className="silo-marker"
            data-active={lane.open && lane.focusIds.some((id) => ids.includes(id))}
            data-count={count > 1 ? count : undefined}
            aria-label={`${count} highlight${count > 1 ? 's' : ''} on paragraph ${group.para}`}
            style={{
              top: y - gutter.size / 2,
              left,
              width: gutter.size,
              height: gutter.size,
              visibility: hidden ? 'hidden' : undefined,
            }}
            onMouseEnter={() => lane.setHoveredIds(ids)}
            onMouseLeave={() => lane.setHoveredIds([])}
            onFocus={() => lane.setHoveredIds(ids)}
            onBlur={() => lane.setHoveredIds([])}
            onClick={() => lane.onMarker(ids)}
          >
            <ReaderIcon name="note" size={20} />
            {count > 1 && <small>{count}</small>}
          </button>
        );
      })}
    </>,
    frame,
  );
}
