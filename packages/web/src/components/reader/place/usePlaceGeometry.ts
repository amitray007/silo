import { useLayoutEffect, useState } from 'react';
import { dialClip, ribbonPosition } from './geometry';

export function usePlaceGeometry(
  prose: HTMLElement,
  scroll: HTMLElement,
  panel: HTMLElement,
  block: Element | undefined,
  hover: Element | null,
) {
  const [ribbon, setRibbon] = useState<ReturnType<typeof ribbonPosition> | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof ribbonPosition> | null>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      setRibbon(block ? ribbonPosition(block, scroll) : null);
      setPreview(hover ? ribbonPosition(hover, scroll) : null);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const resize = new ResizeObserver(schedule);
    resize.observe(prose);
    resize.observe(scroll);
    const changes = new MutationObserver(schedule);
    changes.observe(prose.closest('.silo-reader') ?? prose, {
      attributes: true,
      subtree: true,
      attributeFilter: ['style'],
    });
    document.fonts?.addEventListener('loadingdone', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      document.fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [prose, scroll, block, hover]);

  // Geometry also changes as paragraph spacing animates and as ribbons scroll through the dial.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ribbon geometry triggers a fresh clipping measurement.
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const cluster = panel.querySelector('.silo-outline-cluster');
      if (!cluster) return;
      const ribbons = Array.from(scroll.querySelectorAll('.silo-place-ribbon')).map((el) =>
        el.getBoundingClientRect(),
      );
      panel.style.setProperty(
        '--silo-ribbon-clip',
        dialClip(cluster.getBoundingClientRect(), ribbons),
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    scroll.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    const changes = new MutationObserver(schedule);
    changes.observe(panel, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', schedule);
      observer.disconnect();
      changes.disconnect();
      panel.style.removeProperty('--silo-ribbon-clip');
    };
  }, [panel, scroll, ribbon, preview]);
  return { ribbon, preview };
}
