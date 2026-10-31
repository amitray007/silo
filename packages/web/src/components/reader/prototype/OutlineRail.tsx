// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
import { useEffect, useMemo, useState } from 'react';
import type { PassageHighlight } from './useHighlights';

type Section = { id: string; el: Element; heading: boolean; top: number; y: number; next: string };
type Group = {
  id: string;
  first: Section;
  heading: Section | undefined;
  y: number;
  color: string | null;
};

const MIN_GAP = 6;

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

/** A vertical tick rail at the left edge: one tick per paragraph, a longer one per heading. */
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

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setWide(panel.clientWidth >= 700);
      setTick((value) => value + 1);
    });
    observer.observe(panel);
    if (prose) observer.observe(prose);
    return () => observer.disconnect();
  }, [panel, prose]);

  const height = Math.max(0, scroll.clientHeight - 68);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-measures after layout changes.
  const groups = useMemo<Group[]>(() => {
    if (!prose || !wide || !height) return [];
    const box = scroll.getBoundingClientRect();
    const proseTop = prose.getBoundingClientRect().top - box.top + scroll.scrollTop;
    const total = Math.max(1, prose.scrollHeight);
    const sections: Section[] = [];
    for (const el of prose.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote')) {
      if (el.parentElement?.closest('li, blockquote, p, pre, figure, table')) continue;
      if (!el.textContent?.trim()) continue;
      const top = el.getBoundingClientRect().top - box.top + scroll.scrollTop;
      sections.push({
        id: `s${sections.length}`,
        el,
        heading: /^H[1-6]$/.test(el.tagName),
        top,
        y: ((top - proseTop) / total) * height,
        next: '',
      });
    }
    sections.forEach((section, i) => {
      section.next = sections[i + 1]?.el.textContent ?? '';
    });
    const result: Group[] = [];
    for (const section of sections) {
      const last = result.at(-1);
      if (last && section.y - last.y < MIN_GAP) {
        if (section.heading && !last.heading) last.heading = section;
        continue;
      }
      result.push({
        id: section.id,
        first: section,
        heading: section.heading ? section : undefined,
        y: section.y,
        color: null,
      });
    }
    // Tint the group that holds a highlight, using the highlight's colour.
    for (const item of items) {
      const node = item.range.startContainer;
      const at = sections.find((section) => section.el.contains(node));
      if (!at) continue;
      const group = [...result].reverse().find((entry) => entry.first.y <= at.y);
      if (group) group.color = item.color;
    }
    return result;
  }, [prose, scroll, wide, height, items, tick]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = scroll.getBoundingClientRect();
      const line = scroll.scrollTop + scroll.clientHeight * 0.38;
      let at = 0;
      groups.forEach((group, i) => {
        const top = group.first.el.getBoundingClientRect().top - box.top + scroll.scrollTop;
        if (top <= line) at = i;
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
  const hovered = hover === null ? undefined : groups[hover];
  const lead = hovered?.heading ?? hovered?.first;
  const text = lead?.el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const summary = lead ? summaryFor(lead.id) : null;
  const title = lead?.heading ? text.slice(0, 90) : firstSentence(text);
  const body = summary ?? (lead?.heading ? lead.next : text.slice(title.length));

  return (
    <nav className="proto-outline" aria-label="Article outline" style={{ height }}>
      {groups.map((group, index) => (
        <button
          key={group.id}
          type="button"
          className="proto-tick"
          data-heading={Boolean(group.heading)}
          data-current={index === current}
          data-color={group.color ?? undefined}
          data-tinted={group.color !== null}
          style={{ top: group.y }}
          aria-label={group.heading ? (group.heading.el.textContent ?? 'Section') : 'Paragraph'}
          onMouseEnter={() => setHover(index)}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(index)}
          onBlur={() => setHover(null)}
          onClick={() =>
            scroll.scrollTo({
              top:
                scroll.scrollTop +
                group.first.el.getBoundingClientRect().top -
                scroll.getBoundingClientRect().top -
                90,
              behavior: 'smooth',
            })
          }
        >
          <i />
        </button>
      ))}
      {hovered && lead && (
        <div
          className="proto-outline-card"
          style={{ top: Math.min(Math.max(hovered.y - 12, 0), Math.max(0, height - 96)) }}
        >
          <strong>{title}</strong>
          {body.trim() && <span>{body.replace(/\s+/g, ' ').trim()}</span>}
        </div>
      )}
    </nav>
  );
}
