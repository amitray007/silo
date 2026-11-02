import { useEffect, useLayoutEffect, useRef } from 'react';
import { reducedMotion, SPRING, SPRING_MS } from './motion';

type Box = { w: number; h: number; r: string };
type Snapshot = { from: Box; ghost: HTMLElement };
export type Anchor = 'top' | 'bottom';

const GHOST_MS = 90;

/** The size of `element` with the radius of the surface it sits in. */
const boxOf = (element: Element, surface: Element = element): Box => {
  const rect = element.getBoundingClientRect();
  return { w: rect.width, h: rect.height, r: getComputedStyle(surface).borderRadius };
};
const sameSize = (a: Box, b: Box) => Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
const sameBox = (a: Box, b: Box) => sameSize(a, b) && a.r === b.r;

/** Hold the content at its final width, centred, so the shell can clip it while the size moves. */
function pin(content: HTMLElement, width: number, anchor: Anchor) {
  content.style.cssText = `position:absolute;left:50%;width:${width}px;margin-left:${-width / 2}px;${anchor}:0`;
}

/** The leaving content fades out in place over the growing shell. */
function fadeGhost(shell: HTMLElement, ghost: HTMLElement, from: Box, anchor: Anchor) {
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
export function useSurfaceMotion(phase: string, anchor: Anchor) {
  const root = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const rest = useRef<Box | null>(null);
  const target = useRef<Box | null>(null);
  const run = useRef<Animation | null>(null);
  const snapshot = useRef<Snapshot | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const anchored = useRef(anchor);
  anchored.current = anchor;

  const begin = () => {
    const element = root.current;
    const content = shell.current?.firstElementChild;
    if (!element || !content || reducedMotion() || typeof element.animate !== 'function') return;
    snapshot.current = { from: boxOf(element), ghost: content.cloneNode(true) as HTMLElement };
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
      sameSize(boxOf(content, element), target.current)
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
    if (!from || sameBox(from, to) || typeof element.animate !== 'function' || reducedMotion())
      return;
    holder.dataset.morphing = '';
    pin(content, to.w, anchored.current);
    if (taken) fadeGhost(holder, taken.ghost, from, anchored.current);
    const motion = element.animate(
      [
        { width: `${from.w}px`, height: `${from.h}px`, borderRadius: from.r },
        { width: `${to.w}px`, height: `${to.h}px`, borderRadius: to.r },
      ],
      { duration: SPRING_MS, easing: SPRING },
    );
    run.current = motion;
    motion.onfinish = () => {
      if (run.current !== motion) return;
      run.current = null;
      content.removeAttribute('style');
      delete holder.dataset.morphing;
    };
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
    };
  }, []);

  return { root, shell, begin };
}
