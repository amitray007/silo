import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BLOCK_SELECTOR, proseTextNodes } from './useProseRoot';

type Line = {
  top: number;
  left: number;
  width: number;
  height: number;
  words: number;
  block: Element;
};

export const MIN_WPM = 60;
export const MAX_WPM = 800;
const WPM_STEP = 20;

/** Group the prose text fragments into visual lines, in scroll-content coordinates. */
function measureLines(root: HTMLElement, scroll: HTMLElement): Line[] {
  const box = scroll.getBoundingClientRect();
  const lines: Line[] = [];
  const range = document.createRange();
  for (const node of proseTextNodes(root)) {
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 1 && rect.height > 1,
    );
    const total = rects.reduce((sum, rect) => sum + rect.width, 0);
    const words = node.data.trim().split(/\s+/).length;
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? root;
    for (const rect of rects) {
      const top = rect.top - box.top + scroll.scrollTop;
      const left = rect.left - box.left + scroll.scrollLeft;
      const share = (words * rect.width) / total;
      const last = lines.at(-1);
      const centre = top + rect.height / 2;
      if (last && last.block === block && centre > last.top && centre < last.top + last.height) {
        const right = Math.max(last.left + last.width, left + rect.width);
        last.left = Math.min(last.left, left);
        last.width = right - last.left;
        last.words += share;
        continue;
      }
      lines.push({ top, left, width: rect.width, height: rect.height, words: share, block });
    }
  }
  return lines;
}

export function usePencil(
  root: HTMLElement | null,
  scroll: HTMLElement | null,
  host: HTMLElement | null,
) {
  const [enabled, setEnabled] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [wpm, setWpmState] = useState(240);
  const [lineIndex, setLineIndex] = useState(0);
  const [lineCount, setLineCount] = useState(0);
  const [progress, setProgress] = useState(0);
  const lines = useRef<Line[]>([]);
  const prefix = useRef<number[]>([]);
  const index = useRef(0);
  const sweep = useRef(0);
  const guide = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const wpmRef = useRef(wpm);
  wpmRef.current = wpm;

  const paint = useCallback(() => {
    const line = lines.current[index.current];
    const el = guide.current;
    if (!line || !el) return;
    el.style.transform = `translate(${line.left}px, ${line.top + line.height + 1}px)`;
    el.style.width = `${line.width}px`;
    if (fill.current) fill.current.style.transform = `scaleX(${sweep.current})`;
    const words = (prefix.current[index.current] ?? 0) + line.words * sweep.current;
    const total = prefix.current.at(-1) ?? 1;
    setProgress(Math.min(100, Math.round((words / total) * 100)));
  }, []);

  const reveal = useCallback(() => {
    const line = lines.current[index.current];
    if (!line || !scroll) return;
    const top = line.top - scroll.scrollTop;
    const view = scroll.clientHeight;
    if (top < 90 || top > view * 0.68)
      scroll.scrollTo({ top: line.top - view * 0.38, behavior: 'smooth' });
  }, [scroll]);

  const goTo = useCallback(
    (next: number, fraction = 0) => {
      const count = lines.current.length;
      if (!count) return;
      index.current = Math.min(count - 1, Math.max(0, next));
      sweep.current = fraction;
      setLineIndex(index.current);
      paint();
      reveal();
    },
    [paint, reveal],
  );

  // Measure the lines whenever the prose or its size changes.
  useEffect(() => {
    if (!enabled || !root || !scroll) return;
    let frame = 0;
    const measure = () => {
      const previous = lines.current.length ? index.current / lines.current.length : 0;
      lines.current = measureLines(root, scroll);
      let sum = 0;
      prefix.current = lines.current.map((line) => {
        const before = sum;
        sum += line.words;
        return before;
      });
      prefix.current.push(sum);
      setLineCount(lines.current.length);
      index.current = Math.min(
        Math.max(0, lines.current.length - 1),
        Math.round(previous * lines.current.length),
      );
      setLineIndex(index.current);
      paint();
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(scroll);
    document.fonts?.addEventListener('loadingdone', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [enabled, root, scroll, paint]);

  // Sweep the current line, then drop to the next.
  useEffect(() => {
    if (!enabled || !playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const line = lines.current[index.current];
      if (line) {
        const seconds = Math.max(0.3, (line.words / wpmRef.current) * 60);
        sweep.current += dt / seconds;
        if (sweep.current >= 1) {
          if (index.current >= lines.current.length - 1) {
            sweep.current = 1;
            paint();
            setPlaying(false);
            return;
          }
          index.current += 1;
          sweep.current = 0;
          setLineIndex(index.current);
          reveal();
        }
        paint();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled, playing, paint, reveal]);

  // Click a line to jump there.
  useEffect(() => {
    if (!enabled || !root || !scroll) return;
    const click = (event: MouseEvent) => {
      if (!window.getSelection()?.isCollapsed) return;
      if (event.target instanceof Element && event.target.closest('a, button, img, pre, figure'))
        return;
      const box = scroll.getBoundingClientRect();
      const y = event.clientY - box.top + scroll.scrollTop;
      let best = -1;
      let distance = Number.POSITIVE_INFINITY;
      lines.current.forEach((line, i) => {
        const d = Math.abs(line.top + line.height / 2 - y);
        if (d < distance) {
          distance = d;
          best = i;
        }
      });
      if (best >= 0 && distance < 24) goTo(best);
    };
    root.addEventListener('click', click);
    return () => root.removeEventListener('click', click);
  }, [enabled, root, scroll, goTo]);

  const setWpm = useCallback((value: number) => {
    setWpmState(Math.min(MAX_WPM, Math.max(MIN_WPM, value)));
  }, []);
  const toggle = useCallback(() => {
    setEnabled(true);
    setPlaying((value) => !value);
  }, []);

  const overlay: ReactNode =
    enabled && host
      ? createPortal(
          <div className="proto-pencil" ref={guide}>
            <div className="proto-pencil-fill" ref={fill} />
          </div>,
          host,
        )
      : null;

  return {
    enabled,
    setEnabled: (value: boolean) => {
      setEnabled(value);
      if (!value) setPlaying(false);
    },
    playing,
    toggle,
    pause: () => setPlaying(false),
    wpm,
    setWpm,
    faster: () => setWpm(wpmRef.current + WPM_STEP),
    slower: () => setWpm(wpmRef.current - WPM_STEP),
    lineIndex,
    lineCount,
    progress,
    move: (delta: number) => goTo(index.current + delta),
    overlay,
  };
}

export type PencilApi = ReturnType<typeof usePencil>;

export type PencilRef = RefObject<PencilApi | null>;
