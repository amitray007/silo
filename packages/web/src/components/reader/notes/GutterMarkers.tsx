import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type Gutter, gutterLeft } from '../gutter';
import { ReaderIcon } from '../ReaderIcon';
import { resolveMarkerYs } from './markerLayout';
import type { Groups } from './useGroups';
import type { NotesLaneApi } from './useNotesLane';

/** The least space between two items in the gutter column. */
const CLEARANCE = 4;

/**
 * One note marker per paragraph, in the gutter column the resume button uses (the same x). A
 * marker that would touch the resume button or the marker above it moves down by whole lines.
 */
export function GutterMarkers({
  frame,
  groups,
  scroll,
  gutter,
  resumeY,
  lane,
  hidden,
}: {
  frame: HTMLElement;
  groups: Groups;
  scroll: HTMLElement;
  gutter: Gutter;
  /** The resume button's centre, in the frame's coordinates; null when there is none. */
  resumeY: number | null;
  lane: NotesLaneApi;
  /** The lane is an overlay panel: the markers step aside. */
  hidden: boolean;
}) {
  const markers = useRef(new Map<number, HTMLButtonElement>());
  useLayoutEffect(() => {
    const measure = () => {
      const current = groups.read().groups;
      const ys = resolveMarkerYs(
        current.map((group) => ({ key: group.para, y: group.y, lineHeight: group.lineHeight })),
        resumeY,
        gutter.size + CLEARANCE,
      );
      const left = gutterLeft(frame, scroll, gutter);
      return () => {
        for (const group of current) {
          const marker = markers.current.get(group.para);
          if (!marker) continue;
          marker.style.top = `${(ys.get(group.para) ?? group.y) - gutter.size / 2}px`;
          marker.style.left = `${left}px`;
        }
      };
    };
    measure()();
    return groups.subscribe(measure);
  }, [groups, frame, scroll, gutter, resumeY]);
  if (groups.groups.length === 0) return null;
  return createPortal(
    groups.groups.map((group) => {
      const ids = group.items.map((item) => item.id);
      const count = ids.length;
      return (
        <button
          key={group.para}
          ref={(element) => {
            if (element) markers.current.set(group.para, element);
            else markers.current.delete(group.para);
          }}
          type="button"
          className="silo-marker"
          data-active={lane.open && lane.focusIds.some((id) => ids.includes(id))}
          data-count={count > 1 ? count : undefined}
          aria-label={`${count} highlight${count > 1 ? 's' : ''} on paragraph ${group.para}`}
          style={{
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
    }),
    frame,
  );
}
