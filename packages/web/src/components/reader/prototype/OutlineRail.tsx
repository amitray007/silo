// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
// biome-ignore-all lint/a11y/noStaticElementInteractions: hover cluster, prototype
import {
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { paragraphSections } from './paragraphs.prototype';
import type { PassageHighlight } from './useHighlights';

type Section = { el: Element; heading: boolean; next: string; number: number };
type Group = {
  id: number;
  sections: Section[];
  heading: Section | undefined;
  color: string | null;
};

const MAX_TICKS = 40;
const STEP = 6; // 2px tick plus a 4px gap
const PAD = 6; // cluster padding above the first tick
const BASE = 12;
const CREST = 36;
const REACH = STEP * 5; // the wave falls off over about five ticks
const FAR = 1e5;
const SPRING = { stiffness: 300, damping: 25, mass: 0.5 };

/** One tick: its pointer distance drives a spring that lifts its width and brightness. */
function Tick({
  index,
  pointerY,
  reduced,
  crest,
  entry,
  current,
  onEnter,
  onClick,
}: {
  index: number;
  pointerY: MotionValue<number>;
  reduced: boolean;
  crest: boolean;
  entry: Group;
  current: boolean;
  onEnter: () => void;
  onClick: () => void;
}) {
  const centre = PAD + index * STEP + STEP / 2;
  const rest = current ? 20 : BASE;
  const lift = useTransform(pointerY, (y) => Math.max(0, 1 - Math.abs(y - centre) / REACH));
  const spring = useSpring(lift, SPRING);
  const width = useTransform(spring, (m) => rest + m * (CREST - rest));
  const opacity = useTransform(spring, (m) => 0.55 + 0.45 * m);
  return (
    <button
      type="button"
      className="proto-tick"
      data-heading={Boolean(entry.heading)}
      data-current={current}
      data-crest={reduced && crest}
      data-color={entry.color ?? undefined}
      data-tinted={entry.color !== null}
      aria-label={entry.heading ? (entry.heading.el.textContent ?? 'Section') : 'Paragraph'}
      onMouseEnter={onEnter}
      onFocus={onEnter}
      onClick={onClick}
    >
      <motion.i style={reduced ? {} : { width, opacity }} />
    </button>
  );
}

/**
 * Seam for an optional AI section summary. Returns null for now, so the rail shows the
 * paragraph's own text. A later version can return a short summary for the section.
 */
export function summaryFor(_sectionId: string): string | null {
  return null;
}

function firstSentence(text: string): string {
  const match = text.match(/^.{12,}?[.!?](?=\s|$)/);
  return (match?.[0] ?? text).slice(0, 90);
}

function collect(prose: HTMLElement): Section[] {
  const sections = paragraphSections(prose).map((el, i) => ({
    el,
    heading: /^H[1-6]$/.test(el.tagName),
    next: '',
    number: i + 1,
  }));
  sections.forEach((section, i) => {
    section.next = sections[i + 1]?.el.textContent ?? '';
  });
  return sections;
}

/** Group neighbours so the rail never holds more than MAX_TICKS; a heading starts a new group. */
function group(sections: Section[]): Group[] {
  for (let size = 1; ; size += 1) {
    const result: Group[] = [];
    for (const section of sections) {
      const last = result.at(-1);
      if (last && !section.heading && last.sections.length < size) {
        last.sections.push(section);
        continue;
      }
      result.push({
        id: result.length,
        sections: [section],
        heading: section.heading ? section : undefined,
        color: null,
      });
    }
    if (result.length <= MAX_TICKS || size > sections.length) return result;
  }
}

/** A compact, centred cluster of ticks: one per paragraph group, a wider one per heading. */
export function OutlineRail({
  prose,
  scroll,
  panel,
  items,
}: {
  prose: HTMLElement | null;
  scroll: HTMLElement;
  panel: HTMLElement;
  items: PassageHighlight[];
}) {
  const [wide, setWide] = useState(true);
  const [tick, setTick] = useState(0);
  const [current, setCurrent] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReducedMotion() ?? false;
  const pointerY = useMotionValue(FAR);
  const cardY = useSpring(0, SPRING);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setWide(panel.clientWidth >= 700);
      setHeight(panel.clientHeight - 44);
      setTick((value) => value + 1);
    });
    observer.observe(panel);
    if (prose) observer.observe(prose);
    return () => observer.disconnect();
  }, [panel, prose]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-reads the DOM after layout changes.
  const groups = useMemo(() => {
    if (!prose || !wide) return [];
    const result = group(collect(prose));
    for (const item of items) {
      const node = item.range.startContainer;
      const hit = result.find((entry) =>
        entry.sections.some((section) => section.el.contains(node)),
      );
      if (hit) hit.color = item.color;
    }
    return result;
  }, [prose, wide, items, tick]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = scroll.getBoundingClientRect().top + scroll.clientHeight * 0.38;
      let at = 0;
      groups.forEach((entry, i) => {
        if (
          entry.sections[0]?.el.getBoundingClientRect().top !== undefined &&
          (entry.sections[0]?.el.getBoundingClientRect().top ?? 0) <= line
        )
          at = i;
      });
      setCurrent(at);
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
  }, [scroll, groups]);

  const clusterHeight = groups.length * STEP;
  const centre = (height - clusterHeight) / 2;
  const cardTop =
    hover === null
      ? 0
      : Math.min(Math.max(centre + PAD + hover * STEP - 18, 12), Math.max(12, height - 170));
  // The card rides a spring toward the crest tick.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cardY is a stable motion value.
  useEffect(() => {
    if (hover !== null) cardY.set(cardTop);
  }, [hover, cardTop]);
  if (!wide || !groups.length) return null;
  const hovered = hover === null ? undefined : groups[hover];
  const lead = hovered?.heading ?? hovered?.sections[0];
  const text = lead?.el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const summary = lead ? summaryFor(String(hovered?.id)) : null;
  const title = lead?.heading ? text.slice(0, 90) : firstSentence(text);
  const body = (summary ?? (lead?.heading ? lead.next : text.slice(title.length)))
    .replace(/\s+/g, ' ')
    .trim();
  return (
    <nav className="proto-outline" aria-label="Article outline">
      <div
        className="proto-cluster"
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
      >
        {groups.map((entry, index) => (
          <Tick
            key={entry.id}
            index={index}
            pointerY={pointerY}
            reduced={reduced}
            crest={hover === index}
            entry={entry}
            current={index === current}
            onEnter={() => setHover(index)}
            onClick={() => {
              const el = entry.sections[0]?.el;
              if (!el) return;
              scroll.scrollTo({
                top:
                  scroll.scrollTop +
                  el.getBoundingClientRect().top -
                  scroll.getBoundingClientRect().top -
                  90,
                behavior: 'smooth',
              });
            }}
          />
        ))}
      </div>
      {hovered && lead && (
        <motion.div className="proto-outline-card" style={{ top: reduced ? cardTop : cardY }}>
          <strong>
            {title}
            <em>¶{lead.number}</em>
          </strong>
          {body && <span>{body}</span>}
        </motion.div>
      )}
    </nav>
  );
}
