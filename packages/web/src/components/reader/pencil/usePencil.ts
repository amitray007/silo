import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../../../lib/breakpoints';
import {
  MAX_PENCIL_WPM,
  MIN_PENCIL_WPM,
  PENCIL_WPM_STEP,
  type PencilStyle,
  usePencilPrefs,
  useReaderType,
} from '../../../lib/readerPrefs';
import { useReaderWidth } from '../../../lib/useReaderWidth';
import {
  advance,
  type Line,
  lineNear,
  measureLines,
  pointAtShare,
  shareAt,
  wordPrefix,
} from './lines';

/** Saves closer together than this share of the article are not worth a request. */
const SAVE_EPSILON = 0.002;
/** While playing, the position is saved this often. */
const SAVE_EVERY_MS = 10_000;
/** A share at or below this is "not started"; at or above the other, "finished". */
const NOT_STARTED = 0.001;
const FINISHED = 0.995;

type Point = { index: number; sweep: number };
type SaveOptions = { keepalive?: boolean };

/** Where the frame's top sits inside the scrolled content, so line tops can be compared with it. */
function frameOffset(frame: HTMLElement, scroll: HTMLElement): number {
  return frame.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
}

/** Keep the line in the middle third of the pane, recentring toward the direction of travel. */
function revealLine(
  line: Line,
  frame: HTMLElement,
  scroll: HTMLElement,
  direction: number,
  reduced: boolean,
): void {
  const top = frameOffset(frame, scroll) + line.top;
  const view = scroll.clientHeight;
  if (view <= 0) return;
  const at = (top - scroll.scrollTop) / view;
  if (at >= 1 / 3 && at <= 2 / 3) return;
  scroll.scrollTo({
    top: top - view * (direction < 0 ? 0.6 : 0.4),
    behavior: reduced ? 'auto' : 'smooth',
  });
}

/** Draw the guide on a line. Underline is a 2px rule under the text; Highlighter is a band. */
function paintGuide(
  guide: HTMLElement,
  fill: HTMLElement | null,
  line: Line,
  style: PencilStyle,
  sweep: number,
): void {
  const band = style === 'highlighter';
  guide.style.transform = band
    ? `translate(${line.left - 4}px, ${line.top - 2}px)`
    : `translate(${line.left}px, ${line.top + line.height + 1}px)`;
  guide.style.width = `${line.width + (band ? 8 : 0)}px`;
  guide.style.height = band ? `${line.height + 4}px` : '2px';
  if (fill) fill.style.transform = `scaleX(${sweep})`;
}

/** The first line whose top is below the pane's top edge, for a pencil started mid-article. */
function firstLineInView(lines: readonly Line[], frame: HTMLElement, scroll: HTMLElement): number {
  const edge = scroll.scrollTop + 56;
  const offset = frameOffset(frame, scroll);
  const found = lines.findIndex((line) => offset + line.top >= edge);
  return found < 0 ? 0 : found;
}

/**
 * Where the pencil stands after the lines were measured. A re-measure keeps the share of words
 * it was at; the first measure starts at the saved position, else (with the pencil on) at the
 * first line in view, else at the top.
 */
function pointAfterMeasure({
  lines,
  prefix,
  keep,
  saved,
  start,
}: {
  lines: readonly Line[];
  prefix: readonly number[];
  keep: number | null;
  saved: number | null;
  start: (() => number) | null;
}): Point {
  if (keep !== null) return pointAtShare(lines, prefix, keep);
  const resume = resumeShare(saved);
  if (resume !== null) return { index: pointAtShare(lines, prefix, resume).index, sweep: 0 };
  return { index: start ? start() : 0, sweep: 0 };
}

/** A saved share the pencil resumes from: after the start and before the end of the article. */
function resumeShare(saved: number | null): number | null {
  return saved !== null && saved > NOT_STARTED && saved < FINISHED ? saved : null;
}

type PencilResume = { y: number };

/**
 * The reading pencil: a guide that sweeps one line at a time at a set pace. Measuring, painting
 * and the animation frame loop live here; nothing runs while the pencil is off or paused, except
 * the measuring that places the resume point when a position is saved.
 *
 * `saved` is the server's share of words already read. `onSave` stores a new one: when the
 * pencil pauses or stops, every 10 seconds while it plays, and (with `keepalive`) as the page
 * hides.
 */
export function usePencil({
  prose,
  scroll,
  saved,
  canSave,
  onSave,
}: {
  prose: HTMLElement | null;
  scroll: HTMLElement | null;
  saved: number | null;
  canSave: boolean;
  onSave: (share: number, options?: SaveOptions) => Promise<void>;
}) {
  const { prefs, update } = usePencilPrefs();
  const { type } = useReaderType();
  const [width] = useReaderWidth();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const frame = prose?.parentElement ?? null;
  const [enabled, setEnabled] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resumeY, setResumeY] = useState<number | null>(null);

  const lines = useRef<Line[]>([]);
  const prefix = useRef<number[]>([0]);
  const point = useRef<Point>({ index: 0, sweep: 0 });
  const guide = useRef<HTMLDivElement | null>(null);
  const fill = useRef<HTMLDivElement | null>(null);
  const live = useRef({ enabled, saved, canSave, onSave, prefs, reduced });
  live.current = { enabled, saved, canSave, onSave, prefs, reduced };
  // The share last sent (or confirmed), and the last one the server confirmed. They differ
  // while a save is out, and a failed save puts the first back on the second so it retries.
  const lastSaved = useRef(saved ?? -1);
  const confirmed = useRef(saved ?? -1);
  // True until the pencil has a place from a saved position or a start of its own.
  const viewportStart = useRef(true);

  const paint = useCallback(() => {
    const line = lines.current[point.current.index];
    if (!line) return;
    if (guide.current)
      paintGuide(guide.current, fill.current, line, live.current.prefs.style, point.current.sweep);
    const share = shareAt(lines.current, prefix.current, point.current.index, point.current.sweep);
    setProgress(Math.min(100, Math.round(share * 100)));
  }, []);

  const reveal = useCallback(
    (direction = 1) => {
      const line = lines.current[point.current.index];
      if (line && frame && scroll) revealLine(line, frame, scroll, direction, live.current.reduced);
    },
    [frame, scroll],
  );

  const flush = useCallback((options?: SaveOptions) => {
    const now = live.current;
    if (!now.enabled || !now.canSave || !lines.current.length) return;
    const share = shareAt(lines.current, prefix.current, point.current.index, point.current.sweep);
    // A page that is closing cannot wait for a request in flight, so it compares with what the
    // server has confirmed.
    const baseline = options?.keepalive ? confirmed.current : lastSaved.current;
    if (Math.abs(share - baseline) < SAVE_EPSILON) return;
    lastSaved.current = share;
    now.onSave(share, options).then(
      () => {
        confirmed.current = share;
      },
      () => {
        lastSaved.current = confirmed.current;
      },
    );
  }, []);

  /** Line the saved share falls on, for the resume button. */
  const placeResume = useCallback(() => {
    const share = resumeShare(live.current.saved);
    const line =
      share !== null
        ? lines.current[pointAtShare(lines.current, prefix.current, share).index]
        : undefined;
    setResumeY(line ? line.top + line.height / 2 : null);
  }, []);

  // New prose is a new article: forget the old lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different prose element resets.
  useEffect(() => {
    lines.current = [];
    prefix.current = [0];
    point.current = { index: 0, sweep: 0 };
    setResumeY(null);
  }, [prose]);

  // Measure the lines when the pencil is on or a resume point needs a place, and again when the
  // prose changes size: a resize, a type setting, a late font or image.
  const resumable = resumeShare(saved) !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: type and width re-run the measuring after the prose restyles.
  useEffect(() => {
    if (!(enabled || resumable) || !prose || !frame || !scroll) return;
    let raf = 0;
    const measure = () => {
      const first = lines.current.length === 0;
      const keep = first
        ? null
        : shareAt(lines.current, prefix.current, point.current.index, point.current.sweep);
      lines.current = measureLines(prose, frame);
      prefix.current = wordPrefix(lines.current);
      point.current = pointAfterMeasure({
        lines: lines.current,
        prefix: prefix.current,
        keep,
        saved: live.current.saved,
        start: live.current.enabled ? () => firstLineInView(lines.current, frame, scroll) : null,
      });
      if (first && (live.current.enabled || resumeShare(live.current.saved) !== null))
        viewportStart.current = false;
      paint();
      placeResume();
      if (first && live.current.enabled) reveal();
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(prose);
    observer.observe(scroll);
    document.fonts?.addEventListener('loadingdone', schedule);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [enabled, resumable, prose, frame, scroll, type, width, paint, placeResume, reveal]);

  // A saved position that arrives or changes while the pencil is off moves the resume point.
  useEffect(() => {
    // Take the server's value only while no save of ours is out; an optimistic value is not one.
    if (lastSaved.current === confirmed.current) {
      lastSaved.current = saved ?? -1;
      confirmed.current = saved ?? -1;
    }
    if (live.current.enabled || !lines.current.length) return;
    const share = resumeShare(saved);
    viewportStart.current = share === null;
    point.current = { ...pointAtShare(lines.current, prefix.current, share ?? 0), sweep: 0 };
    paint();
    placeResume();
  }, [saved, paint, placeResume]);

  // The style changes how the guide is drawn, which matters most while the pencil is paused.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `paint` reads the style from the ref.
  useEffect(() => paint(), [prefs.style, paint]);

  // Sweep the current line, then drop to the next. One frame loop, only while playing.
  useEffect(() => {
    if (!enabled || !playing) return;
    let raf = 0;
    let last = performance.now();
    const stopAtEnd = () => {
      setPlaying(false);
      flush();
    };
    const tick = (now: number) => {
      const seconds = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      const next = advance(lines.current, point.current, seconds, live.current.prefs.wpm);
      const moved = next.index !== point.current.index;
      point.current = { index: next.index, sweep: next.sweep };
      paint();
      if (moved) reveal();
      if (next.ended) return stopAtEnd();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const timer = window.setInterval(() => flush(), SAVE_EVERY_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(timer);
    };
  }, [enabled, playing, paint, reveal, flush]);

  // Click a line to move the pencil there.
  useEffect(() => {
    if (!enabled || !prose || !frame) return;
    const onClick = (event: MouseEvent) => {
      if (!window.getSelection()?.isCollapsed) return;
      if (event.target instanceof Element && event.target.closest('a, button, img, pre, figure'))
        return;
      const best = lineNear(lines.current, event.clientY - frame.getBoundingClientRect().top);
      if (best < 0) return;
      point.current = { index: best, sweep: 0 };
      paint();
    };
    prose.addEventListener('click', onClick);
    return () => prose.removeEventListener('click', onClick);
  }, [enabled, prose, frame, paint]);

  // Save as the page hides, and once more when the reader leaves this article.
  useEffect(() => {
    const onHide = () => flush({ keepalive: true });
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush();
    };
  }, [flush]);

  const bindGuide = useCallback(
    (element: HTMLDivElement | null) => {
      guide.current = element;
      if (element) paint();
    },
    [paint],
  );
  const bindFill = useCallback((element: HTMLDivElement | null) => {
    fill.current = element;
  }, []);

  const stop = useCallback(() => {
    flush();
    setEnabled(false);
    setPlaying(false);
    live.current = { ...live.current, enabled: false };
  }, [flush]);
  const start = useCallback(() => {
    // With nothing to resume, start where the reader is: the first line in view.
    if (!live.current.enabled && viewportStart.current && lines.current.length && frame && scroll) {
      point.current = { index: firstLineInView(lines.current, frame, scroll), sweep: 0 };
      viewportStart.current = false;
      paint();
    }
    live.current = { ...live.current, enabled: true };
    setEnabled(true);
    setPlaying(true);
    if (lines.current.length) reveal();
  }, [reveal, frame, scroll, paint]);
  const pause = useCallback(() => {
    setPlaying(false);
    flush();
  }, [flush]);
  const togglePlay = useCallback(() => (playing ? pause() : start()), [playing, pause, start]);
  const toggleEnabled = useCallback(() => (enabled ? stop() : start()), [enabled, stop, start]);
  const move = useCallback(
    (delta: number) => {
      const count = lines.current.length;
      if (!count) return;
      point.current = {
        index: Math.min(count - 1, Math.max(0, point.current.index + delta)),
        sweep: 0,
      };
      paint();
      reveal(delta);
    },
    [paint, reveal],
  );
  const setWpm = useCallback(
    (wpm: number) => update({ wpm: Math.min(MAX_PENCIL_WPM, Math.max(MIN_PENCIL_WPM, wpm)) }),
    [update],
  );

  const resume: PencilResume | null =
    !enabled && resumeY !== null && canSave ? { y: resumeY } : null;
  return {
    enabled,
    playing,
    wpm: prefs.wpm,
    style: prefs.style,
    progress,
    resume,
    bindGuide,
    bindFill,
    start,
    stop,
    pause,
    togglePlay,
    toggleEnabled,
    move,
    setWpm,
    faster: () => setWpm(prefs.wpm + PENCIL_WPM_STEP),
    slower: () => setWpm(prefs.wpm - PENCIL_WPM_STEP),
    setStyle: (style: PencilStyle) => update({ style }),
  };
}

export type PencilApi = ReturnType<typeof usePencil>;
