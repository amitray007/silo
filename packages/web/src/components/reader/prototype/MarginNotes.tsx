// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { paragraphNumber } from './paragraphs.prototype';
import type { PassageHighlight } from './useHighlights';

/** Free space right of the text column needed for full margin notes (the rule asks for about 240). */
export const FULL_MIN = 200;

type Place = { id: string; item: PassageHighlight; x: number; y: number; para: number };

/**
 * Notes in the right margin, beside the highlighted line, joined to a dot at the line end by a thin
 * connector. When the margin is too narrow, only a compact marker is shown.
 */
export function MarginNotes({
  items,
  prose,
  scroll,
  host,
  hovered,
  setHovered,
  onOpen,
}: {
  items: PassageHighlight[];
  prose: HTMLElement | null;
  scroll: HTMLElement;
  host: HTMLElement;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const [tick, setTick] = useState(0);
  const [tops, setTops] = useState<Record<string, number>>({});
  const lane = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!prose) return;
    const bump = () => setTick((value) => value + 1);
    const observer = new ResizeObserver(bump);
    observer.observe(prose);
    observer.observe(scroll);
    document.fonts?.addEventListener('loadingdone', bump);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', bump);
    };
  }, [prose, scroll]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-measures after layout changes.
  const measured = useMemo(() => {
    if (!prose) return null;
    const box = scroll.getBoundingClientRect();
    const proseRight = prose.getBoundingClientRect().right - box.left;
    const free = scroll.clientWidth - proseRight;
    const places: Place[] = [];
    const used = new Map<number, number>();
    for (const item of items.filter((entry) => entry.note)) {
      const rects = Array.from(item.range.getClientRects());
      const last = rects.at(-1);
      if (!last) continue;
      const y = last.top + last.height / 2 - box.top + scroll.scrollTop;
      // Dots on the same line fan out sideways so they do not overlap.
      const row = Math.round(y);
      const shift = (used.get(row) ?? 0) * 9;
      used.set(row, (used.get(row) ?? 0) + 1);
      places.push({
        id: item.id,
        item,
        x: last.right - box.left + scroll.scrollLeft + 7 + shift,
        y,
        para: paragraphNumber(prose, item.range.startContainer),
      });
    }
    places.sort((a, b) => a.y - b.y);
    return { places, proseRight, free, full: free >= FULL_MIN };
  }, [items, prose, scroll, tick]);

  // Stack the notes so they never overlap, each as close to its line as it can be.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-stack when the notes or lines change.
  useLayoutEffect(() => {
    if (!measured?.full || !lane.current) return;
    const next: Record<string, number> = {};
    let floor = Number.NEGATIVE_INFINITY;
    for (const place of measured.places) {
      const el = lane.current.querySelector<HTMLElement>(`[data-note="${place.id}"]`);
      const height = el?.offsetHeight ?? 40;
      const top = Math.max(place.y - 14, floor);
      next[place.id] = top;
      floor = top + height + 8;
    }
    setTops((previous) => {
      const same =
        Object.keys(next).length === Object.keys(previous).length &&
        Object.entries(next).every(([k, v]) => previous[k] === v);
      return same ? previous : next;
    });
  }, [measured, items]);

  if (!measured) return null;
  const { places, proseRight, full } = measured;
  if (!places.length) return null;
  const laneLeft = proseRight + 30;
  const laneWidth = Math.max(120, scroll.clientWidth - laneLeft - 12);

  if (!full) {
    // Compact: one marker per paragraph, in the gutter at the line's right edge.
    const groups = new Map<number, Place[]>();
    for (const place of places) groups.set(place.para, [...(groups.get(place.para) ?? []), place]);
    return createPortal(
      <>
        {[...groups.values()].map((group) => {
          const first = group[0] as Place;
          return (
            <button
              key={first.id}
              type="button"
              className="proto-marker"
              data-color={first.item.color}
              data-hover={group.some((place) => place.id === hovered)}
              title={group.map((place) => place.item.note).join('\n')}
              aria-label={`${group.length} note${group.length > 1 ? 's' : ''}, paragraph ${first.para}`}
              style={{ top: first.y - 9, left: Math.min(proseRight + 8, scroll.clientWidth - 22) }}
              onMouseEnter={() => setHovered(first.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onOpen(first.id)}
            >
              {group.length > 1 ? group.length : <i />}
            </button>
          );
        })}
      </>,
      host,
    );
  }

  return createPortal(
    <>
      <svg className="proto-connectors" aria-hidden="true">
        {places.map((place) => {
          const y2 = (tops[place.id] ?? place.y - 14) + 13;
          // The connector drops into the gap under the line so it never strikes through text.
          const lineY = place.y + 12;
          const edge = Math.max(place.x + 14, proseRight + 4);
          const bend = Math.max(10, (laneLeft - edge) / 2);
          const d = `M${place.x} ${place.y}Q${place.x} ${lineY} ${place.x + 8} ${lineY}H${edge}C${edge + bend} ${lineY} ${laneLeft - bend} ${y2} ${laneLeft} ${y2}`;
          return (
            <path
              key={place.id}
              d={d}
              data-color={place.item.color}
              data-hover={hovered === place.id}
            />
          );
        })}
      </svg>
      {places.map((place) => (
        <span
          key={`dot-${place.id}`}
          className="proto-anchor"
          data-color={place.item.color}
          data-hover={hovered === place.id}
          style={{ top: place.y - 3, left: place.x - 3 }}
        />
      ))}
      <div className="proto-lane-b" ref={lane} style={{ left: laneLeft, width: laneWidth }}>
        {places.map((place) => (
          <button
            key={place.id}
            type="button"
            className="proto-mnote"
            data-note={place.id}
            data-color={place.item.color}
            data-hover={hovered === place.id}
            style={{ top: tops[place.id] ?? place.y - 14 }}
            onMouseEnter={() => setHovered(place.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onOpen(place.id)}
          >
            <span className="proto-mnote-text">{place.item.note}</span>
            {place.para > 0 && <span className="proto-mnote-ref">¶{place.para}</span>}
          </button>
        ))}
      </div>
    </>,
    host,
  );
}
