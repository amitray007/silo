import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Slot } from './stack';

type Edges = { up: boolean; down: boolean; hidden: number };
const NO_EDGES: Edges = { up: false, down: false, hidden: 0 };

/** Which way the group can still scroll, and how many blocks sit below its fold. */
function measureEdges(scroller: HTMLElement): Edges {
  let hidden = 0;
  for (const child of Array.from(scroller.children) as HTMLElement[])
    if (child.offsetTop + child.offsetHeight > scroller.scrollTop + scroller.clientHeight + 1)
      hidden += 1;
  return {
    up: scroller.scrollTop > 1,
    down: scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1,
    hidden,
  };
}

/**
 * One paragraph's blocks. The group sits at its slot and scrolls inside itself past its cap, with
 * fade masks only where more content exists and a "+N" chip for the blocks below the fold.
 */
export function LaneGroup({
  groupKey,
  slot,
  version,
  smooth,
  onScrolled,
  children,
}: {
  groupKey: string;
  /** Where the lane's layout put it; undefined until the first layout pass. */
  slot: Slot | undefined;
  /** Changes whenever a block's height does, to re-measure the edges. */
  version: number;
  smooth: boolean;
  /** The group scrolled inside itself, so anything drawn to a block must follow. */
  onScrolled: () => void;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>(NO_EDGES);
  // Moves animate only once the group has been placed, so it never slides in from the top.
  const [armed, setArmed] = useState(false);
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const next = measureEdges(el);
    setEdges((previous) =>
      previous.up === next.up && previous.down === next.down && previous.hidden === next.hidden
        ? previous
        : next,
    );
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the slot and version are the triggers.
  useLayoutEffect(measure, [measure, slot?.max, slot?.top, version]);
  const placed = slot !== undefined;
  useEffect(() => {
    if (!placed) return;
    const frame = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(frame);
  }, [placed]);
  return (
    <div
      className="silo-lgroup"
      data-group={groupKey}
      data-placed={placed}
      data-armed={armed}
      style={{ top: slot?.top ?? 0 }}
    >
      <div
        className="silo-lgroup-scroll"
        ref={scroller}
        data-up={edges.up}
        data-down={edges.down}
        style={{ maxHeight: slot?.max ?? 'none' }}
        onScroll={() => {
          measure();
          onScrolled();
        }}
      >
        {children}
      </div>
      {edges.hidden > 0 && (
        <button
          type="button"
          className="silo-lgroup-more"
          aria-label={`${edges.hidden} more highlights, scroll down`}
          onClick={() =>
            scroller.current?.scrollBy({
              top: scroller.current.clientHeight * 0.9,
              behavior: smooth ? 'smooth' : 'auto',
            })
          }
        >
          +{edges.hidden}
        </button>
      )}
    </div>
  );
}
