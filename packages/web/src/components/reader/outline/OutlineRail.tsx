import {
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { collectSections, groupSections, type OutlineGroup } from './outlineGroups';

/** The pane must be this wide before the rail shows. */
const MIN_PANE_WIDTH = 700;
const STEP = 6; // a 2px tick and a 4px gap
const PAD = 6; // cluster padding above the first tick
const BASE = 12;
const CURRENT = 20;
const CREST = 36;
const REACH = STEP * 5; // the wave falls off over about five ticks
const FAR = 1e5;
const SPRING = { stiffness: 300, damping: 25, mass: 0.5 };
const HEAD_HEIGHT = 44;
const CARD_MAX = 170;

/** One tick: how close the pointer is drives a spring that widens and brightens it. */
const Tick = memo(function Tick({
  index,
  pointerY,
  reduced,
  crest,
  group,
  current,
  onEnter,
  onClick,
}: {
  index: number;
  pointerY: MotionValue<number>;
  reduced: boolean;
  crest: boolean;
  group: OutlineGroup;
  current: boolean;
  onEnter: (index: number) => void;
  onClick: (index: number) => void;
}) {
  const centre = PAD + index * STEP + STEP / 2;
  const rest = current ? CURRENT : BASE;
  const lift = useTransform(pointerY, (y) => Math.max(0, 1 - Math.abs(y - centre) / REACH));
  const spring = useSpring(lift, SPRING);
  const transform = useTransform(spring, (m) => `scaleX(${(rest + m * (CREST - rest)) / CREST})`);
  const opacity = useTransform(spring, (m) => 0.55 + 0.45 * m);
  return (
    <button
      type="button"
      className="silo-tick"
      data-heading={Boolean(group.heading)}
      data-current={current}
      data-crest={reduced && crest}
      aria-label={group.title || 'Paragraph'}
      aria-current={current || undefined}
      onMouseEnter={() => onEnter(index)}
      onFocus={() => onEnter(index)}
      onClick={() => onClick(index)}
    >
      <motion.i
        style={reduced ? {} : { width: CREST, transform, transformOrigin: 'left center', opacity }}
      />
    </button>
  );
});

/** The group the reading line has reached: the last one that starts above 38% of the pane. */
function currentGroup(groups: OutlineGroup[], scroll: HTMLElement): number {
  const line = scroll.getBoundingClientRect().top + scroll.clientHeight * 0.38;
  let at = 0;
  groups.forEach((group, i) => {
    const top = group.sections[0]?.el.getBoundingClientRect().top;
    if (top !== undefined && top <= line) at = i;
  });
  return at;
}

function useCurrentGroup(groups: OutlineGroup[], scroll: HTMLElement): number {
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setCurrent(currentGroup(groups, scroll));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroll.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', onScroll);
    };
  }, [groups, scroll]);
  return current;
}

/** Track the pane's size and, with it, whether the rail shows and when to re-read the prose. */
function usePaneSize(panel: HTMLElement, prose: HTMLElement) {
  const [size, setSize] = useState(() => ({
    wide: panel.clientWidth >= MIN_PANE_WIDTH,
    height: panel.clientHeight - HEAD_HEIGHT,
    version: 0,
  }));
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      setSize((previous) => ({
        wide: panel.clientWidth >= MIN_PANE_WIDTH,
        height: panel.clientHeight - HEAD_HEIGHT,
        version: previous.version + 1,
      })),
    );
    observer.observe(panel);
    observer.observe(prose);
    return () => observer.disconnect();
  }, [panel, prose]);
  return size;
}

/**
 * A compact, centred cluster of ticks at the pane's left edge: one per paragraph group, wider
 * and brighter for headings, the current group in ink. Hovering waves the ticks up like a dock
 * and a card beside the crest names the group. Click scrolls to a group.
 */
export function OutlineRail({
  prose,
  scroll,
  panel,
  hidden = false,
}: {
  prose: HTMLElement;
  scroll: HTMLElement;
  panel: HTMLElement;
  /** The notes lane has moved the column close to the rail. */
  hidden?: boolean;
}) {
  const reduced = useReducedMotion() ?? false;
  const { wide, height, version } = usePaneSize(panel, prose);
  const [hover, setHover] = useState<number | null>(null);
  const pointerY = useMotionValue(FAR);
  const cardY = useSpring(0, SPRING);
  const cardTransform = useTransform(cardY, (y) => `translateY(${y}px)`);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-reads the prose after layout changes.
  const groups = useMemo(
    () => (wide ? groupSections(collectSections(prose)) : []),
    [prose, wide, version],
  );
  const current = useCurrentGroup(groups, scroll);
  const goTo = useCallback(
    (index: number) => {
      const el = groups[index]?.sections[0]?.el;
      if (!el) return;
      scroll.scrollTo({
        top:
          scroll.scrollTop +
          el.getBoundingClientRect().top -
          scroll.getBoundingClientRect().top -
          90,
        behavior: reduced ? 'auto' : 'smooth',
      });
    },
    [groups, scroll, reduced],
  );

  const centre = (height - groups.length * STEP) / 2;
  const cardTop =
    hover === null
      ? 0
      : Math.min(Math.max(centre + PAD + hover * STEP - 18, 12), Math.max(12, height - CARD_MAX));
  // The card rides a spring toward the crest tick.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cardY is a stable motion value.
  useEffect(() => {
    if (hover !== null) cardY.set(cardTop);
  }, [hover, cardTop]);

  if (hidden || !wide || !groups.length) return null;
  const hovered = hover === null ? undefined : groups[hover];
  return (
    <nav className="silo-outline" aria-label="Article outline">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover cluster, the ticks are the buttons. */}
      <div
        className="silo-outline-cluster"
        onPointerMove={(event) => {
          const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
          pointerY.set(y);
          const at = Math.round((y - PAD - STEP / 2) / STEP);
          const next = Math.min(groups.length - 1, Math.max(0, at));
          setHover((previous) => (previous === next ? previous : next));
        }}
        onPointerLeave={() => {
          pointerY.set(FAR);
          setHover(null);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setHover(null);
        }}
      >
        {groups.map((group, index) => (
          <Tick
            key={group.id}
            index={index}
            pointerY={pointerY}
            reduced={reduced}
            crest={hover === index}
            group={group}
            current={index === current}
            onEnter={setHover}
            onClick={goTo}
          />
        ))}
      </div>
      {hovered && (
        <motion.div
          className="silo-outline-card"
          style={reduced ? { top: cardTop } : { top: 0, transform: cardTransform }}
        >
          <strong>{hovered.title}</strong>
          {hovered.body && <span>{hovered.body}</span>}
        </motion.div>
      )}
    </nav>
  );
}
