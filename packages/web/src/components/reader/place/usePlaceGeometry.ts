import { useCallback, useLayoutEffect, useRef } from 'react';
import { dialClip, ribbonPosition } from './geometry';

function paintRibbon(
  element: HTMLElement | null,
  block: Element | null | undefined,
  frame: HTMLElement,
) {
  if (!element || !block) return;
  const position = ribbonPosition(block, frame);
  element.style.top = `${position.top}px`;
  element.style.left = `${position.left}px`;
  element.style.setProperty('--silo-place-row-top', `${position.row - position.top}px`);
  element.style.setProperty('--silo-place-row-width', `${position.width}px`);
  element.style.setProperty('--silo-place-elbow-x', `${position.elbowX}px`);
  element.style.setProperty('--silo-place-elbow-y', `${position.elbowY}px`);
  element.style.setProperty('--silo-place-elbow-height', `${position.top - position.row - 10}px`);
}

/** The frame carries transforms; layout measurements paint directly, before the next paint. */
export function usePlaceGeometry(
  prose: HTMLElement,
  scroll: HTMLElement,
  panel: HTMLElement,
  block: Element | undefined,
  hover: Element | null,
) {
  const frame = prose.parentElement ?? prose;
  const gutter = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLButtonElement>(null);
  const clip = useCallback(() => {
    const cluster = panel.querySelector('.silo-outline-cluster');
    if (!cluster) return;
    const ribbons = Array.from(frame.querySelectorAll('.silo-place-ribbon')).map((el) =>
      el.getBoundingClientRect(),
    );
    const value = dialClip(cluster.getBoundingClientRect(), ribbons);
    if (panel.style.getPropertyValue('--silo-ribbon-clip') !== value)
      panel.style.setProperty('--silo-ribbon-clip', value);
  }, [panel, frame]);
  const measure = useCallback(() => {
    paintRibbon(gutter.current, block, frame);
    paintRibbon(preview.current, hover, frame);
    clip();
  }, [block, hover, frame, clip]);

  useLayoutEffect(() => {
    measure();
    // ResizeObserver runs before paint. Another rAF here would defer this frame's layout.
    const resize = new ResizeObserver(measure);
    for (const element of new Set([prose, frame, scroll, panel, block, hover])) {
      if (element) resize.observe(element);
    }
    const article = prose.closest('.silo-reader') ?? frame;
    resize.observe(article);
    const changes = new MutationObserver((records) => {
      // Ignore our own paint; observing it would keep scheduling the same measurement.
      const external = records.some(
        (record) =>
          !(record.target instanceof Element) ||
          !record.target.closest(
            '.silo-place-ribbon-gutter, .silo-place-ribbon-preview, .silo-pencil',
          ),
      );
      if (external) measure();
    });
    changes.observe(article, {
      attributes: true,
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ['style', 'class', 'data-width'],
    });
    // The dial is pane-fixed and can mount after this effect (it is lazy-loaded).
    const dial = new MutationObserver(clip);
    dial.observe(panel, { childList: true, subtree: true });
    scroll.addEventListener('scroll', clip, { passive: true });
    window.addEventListener('resize', measure);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => {
      resize.disconnect();
      changes.disconnect();
      dial.disconnect();
      scroll.removeEventListener('scroll', clip);
      window.removeEventListener('resize', measure);
      document.fonts?.removeEventListener('loadingdone', measure);
      panel.style.removeProperty('--silo-ribbon-clip');
    };
  }, [prose, frame, scroll, panel, block, hover, measure, clip]);
  return { frame, gutter, preview, measure };
}
