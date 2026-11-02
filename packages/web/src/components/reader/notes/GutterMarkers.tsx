import { memo, useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { type Gutter, gutterLeft } from '../gutter';
import { ReaderIcon } from '../ReaderIcon';
import { resolveMarkerYs } from './markerLayout';
import type { Groups, NoteGroup } from './useGroups';
import type { NotesLaneApi } from './useNotesLane';

/** The least space between two items in the gutter column. */
const CLEARANCE = 4;

/** Markers keep their DOM and icons when only the lane's open state changes. */
const GutterMarker = memo(function GutterMarker({
  group,
  markers,
  size,
  hidden,
  active,
  onHover,
  onMarker,
}: {
  group: NoteGroup;
  markers: Map<number, HTMLButtonElement>;
  size: number;
  hidden: boolean;
  active: boolean;
  onHover: (ids: string[]) => void;
  onMarker: (ids: string[]) => void;
}) {
  const ids = group.items.map((item) => item.id);
  const count = ids.length;
  return (
    <button
      ref={(element) => {
        if (element) markers.set(group.para, element);
        else markers.delete(group.para);
      }}
      type="button"
      className="silo-marker"
      data-active={active}
      data-count={count > 1 ? count : undefined}
      aria-label={`${count} highlight${count > 1 ? 's' : ''} on paragraph ${group.para}`}
      style={{ width: size, height: size, visibility: hidden ? 'hidden' : undefined }}
      onMouseEnter={() => onHover(ids)}
      onMouseLeave={() => onHover([])}
      onFocus={() => onHover(ids)}
      onBlur={() => onHover([])}
      onClick={() => onMarker(ids)}
    >
      <ReaderIcon name="note" size={20} />
      {count > 1 && <small>{count}</small>}
    </button>
  );
});

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
  const handlers = useRef(lane);
  handlers.current = lane;
  const onHover = useCallback((ids: string[]) => handlers.current.setHoveredIds(ids), []);
  const onMarker = useCallback((ids: string[]) => handlers.current.onMarker(ids), []);
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
    groups.groups.map((group) => (
      <GutterMarker
        key={group.para}
        group={group}
        markers={markers.current}
        size={gutter.size}
        hidden={hidden}
        active={lane.open && group.items.some((item) => lane.focusIds.includes(item.id))}
        onHover={onHover}
        onMarker={onMarker}
      />
    )),
    frame,
  );
}
