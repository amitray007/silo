import { useEffect, useLayoutEffect, useRef } from 'react';
import { reducedMotion, SPRING, SPRING_MS } from './motion';

type Box = { w: number; h: number; r: string };
type Snapshot = { from: Box; ghost: HTMLElement; origin: { x: number; y: number } };
export type Anchor = 'top' | 'bottom';
/** `height` follows the content's height only; a surface that fills its column keeps its width. */
type Options = { size?: 'both' | 'height' };

const GHOST_MS = 90;

/** The size of `element` with the radius of the surface it sits in. */
const boxOf = (element: Element, surface: Element = element): Box => {
  const rect = element.getBoundingClientRect();
  return { w: rect.width, h: rect.height, r: getComputedStyle(surface).borderRadius };
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
const sameSize = (a: Box, b: Box, size: Options['size'] = 'both') =>
  near(a.h, b.h) && (size === 'height' || near(a.w, b.w));
const sameBox = (a: Box, b: Box, size: Options['size'] = 'both') =>
  sameSize(a, b, size) && a.r === b.r;

/** Hold the content at its final width, centred, so the shell can clip it while the size moves. */
function pin(content: HTMLElement, width: number, anchor: Anchor) {
  content.style.cssText = `position:absolute;left:50%;width:${width}px;margin-left:${-width / 2}px;${anchor}:0`;
}

/** The leaving content fades out in place over the growing shell. */
function fadeGhost(shell: HTMLElement, ghost: HTMLElement, from: Box, anchor: Anchor) {
  // Not `silo-sb-content`: that class plays the arrival animation, and the ghost only leaves.
  ghost.className = 'silo-sb-ghost';
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  pin(ghost, from.w, anchor);
  ghost.style.pointerEvents = 'none';
  shell.append(ghost);
  const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: GHOST_MS,
    easing: 'ease-out',
    fill: 'forwards',
  });
  fade.onfinish = () => ghost.remove();
}

/**
 * One surface that changes shape. The `root` keeps its own size; its `shell` holds a single
 * content child, keyed by `phase`. When the content changes size, whether by a new phase or by
 * its own growth, the root moves from its old box to the new one on a critically damped spring,
 * so a bar becomes a composer and a card grows line by line instead of jumping. Call `begin`
 * just before a state change that swaps the content to let the old content fade out over the new.
 */
export function useSurfaceMotion(phase: string, anchor: Anchor, { size = 'both' }: Options = {}) {
  const root = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const rest = useRef<Box | null>(null);
  const target = useRef<Box | null>(null);
  const run = useRef<Animation | null>(null);
  /** The slide that carries a surface from where it was to where it now sits; it outlives retargets. */
  const slide = useRef<Animation | null>(null);
  const snapshot = useRef<Snapshot | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const anchored = useRef(anchor);
  anchored.current = anchor;

  const begin = () => {
    const element = root.current;
    const content = shell.current?.firstElementChild;
    if (!element || !content || reducedMotion() || typeof element.animate !== 'function') return;
    const { left, top } = element.getBoundingClientRect();
    snapshot.current = {
      from: boxOf(element),
      ghost: content.cloneNode(true) as HTMLElement,
      origin: { x: left, y: top },
    };
  };

  /** If the surface now sits somewhere else (a phone's bottom sheet), slide it from its old place. */
  const slideFrom = (element: HTMLElement, origin: { x: number; y: number }) => {
    slide.current?.cancel();
    slide.current = null;
    // The size motion is running, so this is where the surface starts, not where it ends.
    const start = element.getBoundingClientRect();
    const dx = origin.x - start.left;
    const dy = origin.y - start.top;
    if (near(dx, 0) && near(dy, 0)) return;
    const move = element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: SPRING_MS, easing: SPRING },
    );
    slide.current = move;
    move.onfinish = () => {
      if (slide.current === move) slide.current = null;
    };
  };

  /** Move the root from `from` to `to` on the spring, with the content held at its final width. */
  const play = (
    element: HTMLElement,
    holder: HTMLElement,
    content: HTMLElement,
    from: Box,
    to: Box,
    taken: Snapshot | null,
  ) => {
    holder.dataset.morphing = '';
    pin(content, to.w, anchored.current);
    if (taken) fadeGhost(holder, taken.ghost, from, anchored.current);
    const edge = (box: Box) => ({
      ...(size === 'both' && { width: `${box.w}px` }),
      height: `${box.h}px`,
      borderRadius: box.r,
    });
    const motion = element.animate([edge(from), edge(to)], {
      duration: SPRING_MS,
      easing: SPRING,
    });
    run.current = motion;
    if (taken) slideFrom(element, taken.origin);
    motion.onfinish = () => {
      if (run.current !== motion) return;
      run.current = null;
      content.removeAttribute('style');
      delete holder.dataset.morphing;
    };
  };

  const settle = () => {
    const element = root.current;
    const holder = shell.current;
    const content = holder?.firstElementChild;
    if (!element || !holder || !(content instanceof HTMLElement)) return;
    const taken = snapshot.current;
    snapshot.current = null;
    if (
      run.current &&
      !taken &&
      target.current &&
      sameSize(boxOf(content, element), target.current, size)
    )
      return;
    const from = taken?.from ?? (run.current ? boxOf(element) : rest.current);
    run.current?.cancel();
    run.current = null;
    content.removeAttribute('style');
    delete holder.dataset.morphing;
    const to = boxOf(content, element);
    rest.current = to;
    target.current = to;
    if (
      !from ||
      sameBox(from, to, size) ||
      typeof element.animate !== 'function' ||
      reducedMotion()
    )
      return;
    play(element, holder, content, from, to, taken);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new phase swaps the content, so settle and watch the new node.
  useLayoutEffect(() => {
    settle();
    observer.current?.disconnect();
    const content = shell.current?.firstElementChild;
    if (content) observer.current?.observe(content);
  }, [phase]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: settle reads refs only, so one observer serves every render.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const watcher = new ResizeObserver(settle);
    observer.current = watcher;
    const content = shell.current?.firstElementChild;
    if (content) watcher.observe(content);
    return () => {
      watcher.disconnect();
      observer.current = null;
      run.current?.cancel();
      slide.current?.cancel();
    };
  }, []);

  return { root, shell, begin };
}
