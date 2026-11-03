import { useEffect, useLayoutEffect, useRef } from 'react';
import { reducedMotion, SPRING, SPRING_MS } from './motion';

export type Anchor = 'top' | 'bottom';
type Snapshot = { box: DOMRect; ghost: HTMLElement };
const GHOST_MS = 90;

/** Only explicit phase changes morph; content growth keeps its natural layout. */
export function useSurfaceMotion(phase: string, anchor: Anchor) {
  const root = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const snapshot = useRef<Snapshot | null>(null);
  const run = useRef<Animation | null>(null);
  const ghost = useRef<HTMLElement | null>(null);

  const clear = () => {
    run.current?.cancel();
    run.current = null;
    ghost.current?.remove();
    ghost.current = null;
    if (shell.current) delete shell.current.dataset.morphing;
  };

  const begin = () => {
    const element = root.current;
    const content = shell.current?.firstElementChild;
    if (!element || !content || reducedMotion() || typeof element.animate !== 'function') return;
    snapshot.current = {
      box: element.getBoundingClientRect(),
      ghost: content.cloneNode(true) as HTMLElement,
    };
    element.getAnimations?.().forEach((animation) => {
      animation.cancel();
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: only an explicit phase change consumes the snapshot.
  useLayoutEffect(() => {
    const taken = snapshot.current;
    snapshot.current = null;
    clear();
    const element = root.current;
    const holder = shell.current;
    if (!taken || !element || !holder || reducedMotion()) return;
    const to = element.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) return;
    const from = taken.box;
    const leaving = taken.ghost;
    leaving.className = 'silo-sb-ghost';
    leaving.inert = true;
    leaving.setAttribute('aria-hidden', 'true');
    leaving.style.cssText = `position:absolute;left:50%;width:${from.width}px;margin-left:${-from.width / 2}px;${anchor}:0;pointer-events:none`;
    holder.append(leaving);
    ghost.current = leaving;
    const fade = leaving.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: GHOST_MS,
      easing: 'ease-out',
      fill: 'forwards',
    });
    fade.onfinish = () => leaving.remove();
    holder.dataset.morphing = '';
    // Account for the origin: scaling around the passage must keep its nearest edge in place.
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = anchor === 'top' ? from.top - to.top : from.bottom - to.bottom;
    const motion = element.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        { transform: 'translate(0, 0) scale(1, 1)' },
      ],
      { duration: SPRING_MS, easing: SPRING },
    );
    run.current = motion;
    motion.onfinish = () => {
      if (run.current !== motion) return;
      run.current = null;
      ghost.current?.remove();
      ghost.current = null;
      delete holder.dataset.morphing;
    };
  }, [phase]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: animations and nodes belong to this mounted surface.
  useEffect(() => clear, []);
  return { root, shell, begin };
}
