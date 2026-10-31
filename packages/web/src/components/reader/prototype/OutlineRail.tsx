// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
// biome-ignore-all lint/a11y/noStaticElementInteractions: hover cluster, prototype
import { useEffect, useMemo, useState } from 'react';
import type { PassageHighlight } from './useHighlights';

type Section = { el: Element; heading: boolean; next: string };
type Group = {
  id: number;
  sections: Section[];
  heading: Section | undefined;
  color: string | null;
};

const MAX_TICKS = 40;
const STEP = 6; // 2px tick plus a 4px gap

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
  const sections: Section[] = [];
  for (const el of prose.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote')) {
    if (el.parentElement?.closest('li, blockquote, p, pre, figure, table')) continue;
    if (!el.textContent?.trim()) continue;
    sections.push({ el, heading: /^H[1-6]$/.test(el.tagName), next: '' });
  }
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

  if (!wide || !groups.length) return null;
  const clusterHeight = groups.length * STEP;
  const hovered = hover === null ? undefined : groups[hover];
  const lead = hovered?.heading ?? hovered?.sections[0];
  const text = lead?.el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const summary = lead ? summaryFor(String(hovered?.id)) : null;
  const title = lead?.heading ? text.slice(0, 90) : firstSentence(text);
  const body = (summary ?? (lead?.heading ? lead.next : text.slice(title.length)))
    .replace(/\s+/g, ' ')
    .trim();
  // Keep the card inside the pane: below the head, above the dock.
  const centre = (height - clusterHeight) / 2;
  const cardTop =
    hover === null
      ? 0
      : Math.min(Math.max(centre + hover * STEP - 18, 12), Math.max(12, height - 170));

  return (
    <nav className="proto-outline" aria-label="Article outline">
      <div className="proto-cluster" onMouseLeave={() => setHover(null)}>
        {groups.map((entry, index) => {
          const near = hover === null ? 99 : Math.abs(index - hover);
          return (
            <button
              key={entry.id}
              type="button"
              className="proto-tick"
              data-heading={Boolean(entry.heading)}
              data-current={index === current}
              data-color={entry.color ?? undefined}
              data-tinted={entry.color !== null}
              data-near={near < 3 ? near : undefined}
              aria-label={entry.heading ? (entry.heading.el.textContent ?? 'Section') : 'Paragraph'}
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
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
            >
              <i />
            </button>
          );
        })}
      </div>
      {hovered && lead && (
        <div className="proto-outline-card" style={{ top: cardTop }}>
          <strong>{title}</strong>
          {body && <span>{body}</span>}
        </div>
      )}
    </nav>
  );
}
