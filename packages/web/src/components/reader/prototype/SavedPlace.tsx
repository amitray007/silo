// THROWAWAY: sentence is the default; line and ribbon remain comparison styles.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProtoIcon } from './ProtoIcon';
import { inTextEntry, plain } from './protoKeys';
import type { PencilApi } from './usePencil';
import type { ReadAloudApi } from './useReadAloud';
import type { SavedPlaceApi } from './useSavedPlace';

export function SavedPlace({
  place,
  prose,
  scroll,
  host,
  panel,
  ra,
  pencil,
  gutterLeft,
}: {
  place: SavedPlaceApi;
  prose: HTMLElement | null;
  scroll: HTMLElement;
  host: HTMLElement;
  panel: HTMLElement;
  ra: ReadAloudApi;
  pencil: PencilApi;
  gutterLeft: number;
}) {
  const [menu, setMenu] = useState(false);
  const [gap, setGap] = useState({ top: 0, left: 0, width: 0 });
  const [pop, setPop] = useState({ top: 0, left: 0 });
  const markButton = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const { saved, paragraphs, save } = place;
  const spacing = useRef(new Map<HTMLElement, { original: string; base: number; extra: number }>());

  // Animate real paragraph space; keep the first visible block fixed when space
  // changes above it. Disable native anchoring so the two do not compensate twice.
  useLayoutEffect(() => {
    const originalAnchor = scroll.style.overflowAnchor;
    scroll.style.overflowAnchor = 'none';
    return () => {
      scroll.style.overflowAnchor = originalAnchor;
      for (const [el, value] of spacing.current) el.style.paddingTop = value.original;
      spacing.current.clear();
    };
  }, [scroll]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: animate the comparison row and hold one viewport anchor.
  useLayoutEffect(() => {
    const block =
      place.style === 'line' && saved ? (paragraphs[saved.paragraph] as HTMLElement) : undefined;
    const targets = new Map<HTMLElement, number>();
    if (block) {
      if (!spacing.current.has(block)) {
        spacing.current.set(block, {
          original: block.style.paddingTop,
          base: Number.parseFloat(getComputedStyle(block).paddingTop) || 0,
          extra: 0,
        });
      }
      const value = spacing.current.get(block);
      if (!value) return;
      const previous = block.previousElementSibling?.getBoundingClientRect();
      const normal = previous
        ? block.getBoundingClientRect().top + value.base - previous.bottom
        : 0;
      targets.set(block, Math.max(0, 56 - normal));
    }
    const starts = new Map([...spacing.current].map(([el, value]) => [el, value.extra]));
    const viewport = scroll.getBoundingClientRect().top;
    const anchor = paragraphs.find((el) => el.getBoundingClientRect().bottom > viewport);
    const contentTop = (el: Element) =>
      el.getBoundingClientRect().top + (Number.parseFloat(getComputedStyle(el).paddingTop) || 0);
    const anchoredTop = anchor ? contentTop(anchor) : 0;
    const start = performance.now();
    let frame = 0;
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one frame updates spacing and its scroll anchor together.
    const tick = (now: number) => {
      const progress = matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 1
        : Math.min(1, (now - start) / 200);
      const eased = 1 - (1 - progress) ** 3;
      for (const [el, value] of spacing.current) {
        const from = starts.get(el) ?? 0;
        value.extra = from + ((targets.get(el) ?? 0) - from) * eased;
        el.style.paddingTop = `${value.base + value.extra}px`;
      }
      if (anchor) scroll.scrollTop += contentTop(anchor) - anchoredTop;
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [place.style, saved, paragraphs, scroll]);

  useLayoutEffect(() => {
    if (!prose || place.style === 'sentence' || !saved) return;
    let frame = 0;
    const measure = () => {
      const block = paragraphs[saved.paragraph];
      if (!block) return;
      const rect = block.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(block);
      const first = range.getClientRects()[0];
      const previous = block.previousElementSibling?.getBoundingClientRect();
      const top = ((previous?.bottom ?? rect.top) + (first?.top ?? rect.top)) / 2;
      const box = scroll.getBoundingClientRect();
      const col = prose.getBoundingClientRect();
      setGap({
        top: top - box.top + scroll.scrollTop,
        left: col.left - box.left,
        width: col.width,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(prose);
    const changes = new MutationObserver(schedule);
    changes.observe(prose, { attributes: true, subtree: true, attributeFilter: ['style'] });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      changes.disconnect();
    };
  }, [prose, paragraphs, saved, scroll, place.style]);

  useEffect(() => {
    if (!prose) return;
    let hide: number | undefined;
    const clearHide = () => {
      window.clearTimeout(hide);
      hide = undefined;
    };
    const leave = () => {
      clearHide();
      place.setHover(null);
    };
    const deferHide = () => {
      // A brief crossing grace lets the pointer reach the gutter, without revealing over whitespace.
      if (hide === undefined) hide = window.setTimeout(leave, 150);
    };
    const move = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.proto-place-button')) {
        clearHide();
        return;
      }
      const block = paragraphs.find(
        (el) => el.tagName === 'P' && el.contains(event.target as Node),
      );
      if (!block || block === paragraphs[saved?.paragraph ?? -1]) {
        deferHide();
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(block);
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 1 && rect.height > 1,
      );
      const first = rects[0];
      const within =
        first &&
        rects.some(
          (rect) =>
            Math.abs(rect.top - first.top) < 3 &&
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        );
      if (within) {
        clearHide();
        place.setHover(block);
      } else deferHide();
    };
    scroll.addEventListener('pointermove', move);
    scroll.addEventListener('pointerleave', leave);
    scroll.addEventListener('scroll', leave, { passive: true });
    return () => {
      clearHide();
      scroll.removeEventListener('pointermove', move);
      scroll.removeEventListener('pointerleave', leave);
      scroll.removeEventListener('scroll', leave);
    };
  }, [prose, scroll, paragraphs, saved, place.setHover]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (inTextEntry(event) || !plain(event) || event.repeat || event.key.toLowerCase() !== 'b')
        return;
      const top = scroll.getBoundingClientRect().top + 24;
      const nearest =
        place.hover ??
        paragraphs
          .filter((el) => el.tagName === 'P')
          .sort(
            (a, b) =>
              Math.abs(a.getBoundingClientRect().top - top) -
              Math.abs(b.getBoundingClientRect().top - top),
          )[0];
      if (nearest) {
        event.preventDefault();
        save(nearest, 'manual');
        setMenu(false);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [paragraphs, save, scroll, place.hover]);

  useEffect(() => {
    if (!menu) return;
    firstAction.current?.focus({ preventScroll: true });
    const close = () => setMenu(false);
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popover.current?.contains(event.target) &&
        !markButton.current?.contains(event.target)
      )
        close();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const buttons = Array.from(popover.current?.querySelectorAll('button') ?? []);
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
      markButton.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onEscape, true);
    document.addEventListener('pointerdown', outside);
    scroll.addEventListener('scroll', close, { passive: true });
    return () => {
      window.removeEventListener('keydown', onEscape, true);
      document.removeEventListener('pointerdown', outside);
      scroll.removeEventListener('scroll', close);
    };
  }, [menu, scroll]);

  const label =
    saved?.source === 'listen'
      ? 'Stopped listening here · Just now'
      : saved?.source === 'pencil'
        ? 'Stopped here · Just now'
        : 'Stopped here · Yesterday';
  const open = () => {
    const rect = markButton.current?.getBoundingClientRect();
    const box = scroll.getBoundingClientRect();
    if (rect)
      setPop({
        left: Math.max(8, Math.min(rect.right - box.left - 244, scroll.clientWidth - 252)),
        top: rect.bottom - box.top + scroll.scrollTop + 6,
      });
    setMenu((value) => !value);
  };
  const bookmark = (className: string) => (
    <button
      type="button"
      className={className}
      ref={markButton}
      aria-label={label}
      aria-expanded={menu}
      aria-haspopup="dialog"
      onClick={open}
    >
      <ProtoIcon name="bookmark" size={14} />
      {place.style !== 'sentence' && <span>{label}</span>}
    </button>
  );
  return (
    <>
      {place.style === 'sentence' && place.anchor && (
        <div className="proto-place-gutter" style={{ top: place.anchor.y - 12, left: gutterLeft }}>
          {place.hover ? (
            <button
              type="button"
              className="proto-place-button proto-place-hover"
              aria-label="Mark reading place"
              title="Mark reading place (B)"
              onClick={() => {
                if (place.hover) save(place.hover, 'manual');
              }}
            >
              <ProtoIcon name="bookmark" size={14} />
            </button>
          ) : (
            saved && bookmark('proto-place-button')
          )}
        </div>
      )}
      {createPortal(
        <>
          {saved && place.style !== 'sentence' && (
            <div
              className="proto-place-mark"
              data-style={place.style}
              style={{ top: gap.top, left: gap.left, width: gap.width }}
            >
              {bookmark('proto-place-label')}
            </div>
          )}
          {menu && saved && (
            <div
              className="proto-place-pop"
              role="dialog"
              aria-label="Saved reading place"
              ref={popover}
              style={pop}
            >
              <div className="proto-place-meta">{label}</div>
              <button
                type="button"
                ref={firstAction}
                onClick={() => {
                  place.continueFrom();
                  if (place.segment) pencil.startAtRange(place.segment.range);
                  setMenu(false);
                }}
              >
                <ProtoIcon name="pencil" size={15} />
                Continue with Pencil
              </button>
              <button
                type="button"
                onClick={() => {
                  place.continueFrom();
                  ra.startAt(place.segment?.id ?? 0);
                  setMenu(false);
                }}
              >
                <ProtoIcon name="headphones" size={15} />
                Listen from here
              </button>
              <button
                type="button"
                onClick={() => {
                  place.remove();
                  setMenu(false);
                }}
              >
                <ProtoIcon name="trash" size={15} />
                Remove
              </button>
            </div>
          )}
        </>,
        host,
      )}
      {saved &&
        place.continuing &&
        createPortal(
          <button
            type="button"
            className="proto-continue"
            onClick={place.jump}
            aria-label={`Continue reading at ${saved.progress}%`}
          >
            <ProtoIcon name="bookmark" size={14} />
            <span>Continue · {saved.progress}%</span>
            <ProtoIcon name="chevronDown" size={13} />
          </button>,
          panel,
        )}
    </>
  );
}
