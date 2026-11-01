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
  const [ribbon, setRibbon] = useState({
    top: 0,
    left: 0,
    row: 0,
    width: 0,
    elbowX: 12,
    elbowY: 0,
  });
  const [preview, setPreview] = useState<{ top: number; left: number } | null>(null);
  const labelButton = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState({ top: 0, left: 0 });
  const markButton = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const { saved, paragraphs, save } = place;
  const spacing = useRef(
    new Map<
      HTMLElement,
      {
        original: string;
        base: number;
        extra: number;
      }
    >(),
  );

  // Reserve the gutter before a mark exists, including on the narrow Reader.
  useLayoutEffect(() => {
    if (place.style !== 'ribbon') return;
    panel.dataset.protoMark = 'ribbon';
    return () => {
      delete panel.dataset.protoMark;
    };
  }, [panel, place.style]);

  // Animate real paragraph space; keep the first visible block fixed when space
  // changes above it. Disable native anchoring so the two do not compensate twice.
  useLayoutEffect(() => {
    const originalAnchor = scroll.style.overflowAnchor;
    scroll.style.overflowAnchor = 'none';
    return () => {
      scroll.style.overflowAnchor = originalAnchor;
      for (const [el, value] of spacing.current) {
        el.style.paddingTop = value.original;
      }
      spacing.current.clear();
    };
  }, [scroll]);

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: animate the comparison row and hold one viewport anchor.
  useLayoutEffect(() => {
    const block =
      place.style !== 'sentence' && saved
        ? (paragraphs[saved.paragraph] as HTMLElement)
        : undefined;
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
      // Leave 18px above the 16px label and preserve its 4px gap to the line.
      // Measure the preceding block so headings, lists and quotes keep their margins.
      targets.set(
        block,
        place.style === 'ribbon' ? Math.max(0, 38 - normal) : Math.max(0, 56 - normal),
      );
    }
    const starts = new Map([...spacing.current].map(([el, value]) => [el, value.extra]));
    const viewport = scroll.getBoundingClientRect().top;
    const anchor = paragraphs.find((el) => el.getBoundingClientRect().bottom > viewport);
    const contentTop = (el: Element) =>
      el.getBoundingClientRect().top + (Number.parseFloat(getComputedStyle(el).paddingTop) || 0);
    const anchoredTop = anchor ? contentTop(anchor) : 0;
    const start = performance.now();
    let frame = 0;
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
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) tick(start);
    else frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [place.style, saved, paragraphs, scroll]);

  useLayoutEffect(() => {
    if (!prose || place.style !== 'line' || !saved) return;
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

  useLayoutEffect(() => {
    if (!prose || place.style !== 'ribbon') return;
    let frame = 0;
    const position = (block: Element) => {
      const rect = block.getBoundingClientRect();
      const css = getComputedStyle(block);
      const box = scroll.getBoundingClientRect();
      const lineTop =
        rect.top + Number.parseFloat(css.paddingTop) + Number.parseFloat(css.borderTopWidth);
      const lineHeight = Number.parseFloat(css.lineHeight);
      return {
        top: lineTop + (lineHeight - 24) / 2 - box.top + scroll.scrollTop,
        left: rect.left + Number.parseFloat(css.paddingLeft) - box.left - 30,
        row: lineTop - 20 - box.top + scroll.scrollTop,
        width:
          rect.width - Number.parseFloat(css.paddingLeft) - Number.parseFloat(css.paddingRight),
        // Snap only the connector; preserve the ribbon and label positions.
        elbowX:
          Math.round((rect.left + Number.parseFloat(css.paddingLeft) - 18) * devicePixelRatio) /
            devicePixelRatio -
          (rect.left + Number.parseFloat(css.paddingLeft) - 30),
        elbowY:
          Math.round((lineTop - 12) * devicePixelRatio) / devicePixelRatio -
          (lineTop + (lineHeight - 24) / 2),
      };
    };
    const measure = () => {
      const block = saved && paragraphs[saved.paragraph];
      if (block) setRibbon(position(block));
      const hovered = place.hover ? position(place.hover) : null;
      setPreview(hovered ? { top: hovered.top, left: hovered.left } : null);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(prose);
    observer.observe(scroll);
    const changes = new MutationObserver(schedule);
    changes.observe(prose.closest('.silo-reader') ?? prose, {
      attributes: true,
      subtree: true,
      attributeFilter: ['style'],
    });
    document.fonts.addEventListener('loadingdone', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      changes.disconnect();
      document.fonts.removeEventListener('loadingdone', schedule);
    };
  }, [prose, scroll, paragraphs, saved, place.style, place.hover]);

  // Keep the shared gutter quiet: cut a 4px-clearance window in the dial
  // around each visible ribbon. Recompute in viewport coordinates as it scrolls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ribbon geometry and visibility trigger DOM measurement.
  useLayoutEffect(() => {
    if (place.style !== 'ribbon') return;
    let frame = 0;
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: merge at most two ribbon windows for one CSS clipping path.
    const measure = () => {
      const cluster = panel.querySelector<HTMLElement>('.proto-cluster');
      if (!cluster) return;
      const box = cluster.getBoundingClientRect();
      const windows = Array.from(host.querySelectorAll<HTMLElement>('.proto-place-ribbon'))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const elbow = el.parentElement
            ?.querySelector('.proto-place-elbow')
            ?.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            top: Math.min(rect.top, elbow?.top ?? rect.top),
            bottom: rect.bottom,
          };
        })
        .filter((rect) => rect.left < box.right && rect.right > box.left)
        .map((rect) => ({
          top: Math.max(0, rect.top - box.top - 4),
          bottom: Math.min(box.height, rect.bottom - box.top + 4),
        }))
        .filter((rect) => rect.top < rect.bottom)
        .sort((a, b) => a.top - b.top);
      const merged: typeof windows = [];
      for (const window of windows) {
        const previous = merged.at(-1);
        if (previous && window.top <= previous.bottom)
          previous.bottom = Math.max(previous.bottom, window.bottom);
        else merged.push({ ...window });
      }
      // Clipping also removes tick hit areas, so the ribbon remains clickable.
      const cutouts = merged
        .map(({ top, bottom }) => `M 0 ${top} H ${box.width} V ${bottom} H 0 Z`)
        .join(' ');
      const clip = merged.length
        ? `path(evenodd, "M 0 0 H ${box.width} V ${box.height} H 0 Z ${cutouts}")`
        : 'none';
      if (panel.style.getPropertyValue('--proto-ribbon-clip') !== clip)
        panel.style.setProperty('--proto-ribbon-clip', clip);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    scroll.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(panel);
    const changes = new MutationObserver(schedule);
    changes.observe(panel, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      scroll.removeEventListener('scroll', schedule);
      resize.disconnect();
      changes.disconnect();
      panel.style.removeProperty('--proto-ribbon-clip');
    };
  }, [place.style, ribbon, preview, saved, place.hover, panel, scroll, host]);

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
      // A brief crossing grace lets the pointer reach the gutter.
      if (hide === undefined) hide = window.setTimeout(leave, 150);
    };
    const hideOutside = () => (place.style === 'ribbon' ? leave() : deferHide());
    const inGutterBridge = (event: PointerEvent) => {
      if (place.style !== 'ribbon' || !place.hover) return false;
      const range = document.createRange();
      range.selectNodeContents(place.hover);
      const first = range.getClientRects()[0];
      // Keep the outlined ribbon reachable across the 6px gutter gap.
      return Boolean(
        first &&
          event.clientX >= first.left - 30 &&
          event.clientX < first.left &&
          event.clientY >= first.top &&
          event.clientY <= first.bottom,
      );
    };
    const withinFirstLine = (block: Element, event: PointerEvent) => {
      const range = document.createRange();
      range.selectNodeContents(block);
      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 1 && rect.height > 1,
      );
      const first = rects[0];
      return Boolean(
        first &&
          rects.some(
            (rect) =>
              Math.abs(rect.top - first.top) < 3 &&
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom,
          ),
      );
    };
    const move = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('.proto-place-button, .proto-place-ribbon')
      ) {
        clearHide();
        return;
      }
      if (inGutterBridge(event)) return;
      const block = paragraphs.find(
        (el) => el.tagName === 'P' && el.contains(event.target as Node),
      );
      if (!block || block === paragraphs[saved?.paragraph ?? -1]) {
        hideOutside();
        return;
      }
      if (!withinFirstLine(block, event)) {
        hideOutside();
        return;
      }
      clearHide();
      place.setHover(block);
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
  }, [prose, scroll, paragraphs, saved, place.setHover, place.style, place.hover]);

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
        !markButton.current?.contains(event.target) &&
        !labelButton.current?.contains(event.target)
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
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onEscape, true);
      document.removeEventListener('pointerdown', outside);
      scroll.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
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
    const box = (place.style === 'ribbon' ? panel : scroll).getBoundingClientRect();
    if (rect && place.style === 'ribbon') {
      const column = prose?.getBoundingClientRect();
      const dial = panel.querySelector('.proto-cluster')?.getBoundingClientRect();
      setPop({
        left: Math.min(
          box.width - 252,
          Math.max(
            (column?.left ?? rect.right + 6) - box.left,
            (dial?.right ?? box.left) - box.left + 8,
          ),
        ),
        top: Math.max(52, Math.min(rect.bottom - box.top + 6, box.height - 168)),
      });
    } else if (rect)
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
          {saved && place.style === 'ribbon' && (
            <div
              className="proto-place-ribbon-gutter"
              style={{ top: ribbon.top, left: ribbon.left }}
            >
              <button
                type="button"
                className="proto-place-ribbon"
                ref={markButton}
                aria-label={label}
                aria-expanded={menu}
                aria-haspopup="dialog"
                onClick={open}
              >
                <ProtoIcon name="bookmark" size={14} />
              </button>
              <i
                className="proto-place-elbow"
                aria-hidden="true"
                style={{
                  left: ribbon.elbowX,
                  top: ribbon.elbowY,
                  height: ribbon.top - ribbon.row - 10,
                }}
              />
              <div
                className="proto-place-ribbon-row"
                style={{ top: ribbon.row - ribbon.top, width: ribbon.width }}
              >
                <button
                  type="button"
                  className="proto-place-ribbon-label"
                  ref={labelButton}
                  aria-expanded={menu}
                  aria-haspopup="dialog"
                  onClick={open}
                >
                  {label}
                </button>
                <i className="proto-place-rule" aria-hidden="true" />
              </div>
            </div>
          )}
          {place.style === 'ribbon' && place.hover && preview && (
            <button
              type="button"
              className="proto-place-ribbon proto-place-ribbon-preview"
              style={preview}
              aria-label="Mark reading place"
              title="Mark reading place"
              onClick={() => {
                if (place.hover) save(place.hover, 'manual');
                setMenu(false);
              }}
            >
              <ProtoIcon name="bookmark" size={14} />
            </button>
          )}
          {saved && place.style === 'line' && (
            <div
              className="proto-place-mark"
              data-style={place.style}
              style={{ top: gap.top, left: gap.left, width: gap.width }}
            >
              {bookmark('proto-place-label')}
            </div>
          )}
        </>,
        host,
      )}
      {menu &&
        saved &&
        createPortal(
          <div
            className="proto-place-pop"
            data-style={place.style}
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
          </div>,
          place.style === 'ribbon' ? panel : host,
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
