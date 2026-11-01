// THROWAWAY: compare ?mark=line with ?mark=ribbon on the existing B reader.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { ProtoIcon } from './ProtoIcon';
import { inTextEntry, plain } from './protoKeys';
import type { ReadAloudApi } from './useReadAloud';
import type { SavedPlaceApi } from './useSavedPlace';

type Gap = { paragraph: number; top: number; left: number; width: number; height: number };

export function SavedPlace({
  place,
  prose,
  scroll,
  host,
  ra,
}: {
  place: SavedPlaceApi;
  prose: HTMLElement | null;
  scroll: HTMLElement;
  host: HTMLElement;
  ra: ReadAloudApi;
}) {
  const [params] = useSearchParams();
  const ribbon = params.get('mark') === 'ribbon';
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [menu, setMenu] = useState(false);
  const markButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const { saved, paragraphs, save } = place;

  useLayoutEffect(() => {
    if (!prose) return;
    let frame = 0;
    const measure = () => {
      const box = scroll.getBoundingClientRect();
      const column = prose.getBoundingClientRect();
      setGaps(
        paragraphs.map((el, paragraph) => {
          const rect = el.getBoundingClientRect();
          const previous = (
            el.previousElementSibling ?? paragraphs[paragraph - 1]
          )?.getBoundingClientRect();
          const available = Math.max(0, rect.top - (previous?.bottom ?? rect.top - 24));
          const height = Math.min(28, available);
          return {
            paragraph,
            top: rect.top - box.top + scroll.scrollTop - available / 2,
            left: column.left - box.left + scroll.scrollLeft,
            width: column.width,
            height,
          };
        }),
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(prose);
    observer.observe(scroll);
    // The notes lane moves the column on a spring; follow that transform too.
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
  }, [prose, scroll, paragraphs]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (inTextEntry(event) || !plain(event) || event.repeat || event.key.toLowerCase() !== 'b')
        return;
      const top = scroll.getBoundingClientRect().top + 24;
      const nearest = paragraphs
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
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [paragraphs, save, scroll]);

  useEffect(() => {
    if (!menu) return;
    removeButton.current?.focus({ preventScroll: true });
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

  const gap = saved ? gaps[saved.paragraph] : undefined;
  const label =
    saved?.source === 'listen'
      ? 'Stopped listening here · Just now'
      : saved?.source === 'pencil'
        ? 'Stopped here · Just now'
        : 'Stopped here · Yesterday';
  const sentence =
    saved?.source === 'listen' && saved.sentence !== undefined
      ? ra.segments[saved.sentence]
      : undefined;
  const sentenceRect = sentence?.range.getClientRects()[0];
  const scrollBox = scroll.getBoundingClientRect();
  return (
    <>
      {createPortal(
        <>
          {gaps
            .filter(
              (entry) =>
                entry.height >= 12 &&
                paragraphs[entry.paragraph]?.tagName === 'P' &&
                paragraphs[entry.paragraph]?.previousElementSibling?.tagName === 'P' &&
                entry.paragraph !== saved?.paragraph,
            )
            .map((entry) => (
              <div
                key={entry.paragraph}
                className="proto-place-gap"
                style={{
                  top: entry.top - entry.height / 2,
                  left: entry.left,
                  width: entry.width,
                  height: entry.height,
                }}
              >
                <button
                  type="button"
                  className="proto-place-add"
                  aria-label="Mark reading place"
                  title="Mark reading place (B)"
                  onClick={() => {
                    save(paragraphs[entry.paragraph], 'manual');
                    setMenu(false);
                  }}
                >
                  <ProtoIcon name="bookmark" size={15} />
                </button>
              </div>
            ))}
          {gap && (
            <div
              className="proto-place-mark"
              data-style={ribbon ? 'ribbon' : 'line'}
              data-source={saved?.source}
              style={{ top: gap.top, left: gap.left, width: gap.width }}
            >
              <button
                type="button"
                className="proto-place-label"
                ref={markButton}
                aria-label={label}
                aria-expanded={menu}
                aria-haspopup="dialog"
                onClick={() => setMenu((value) => !value)}
              >
                <ProtoIcon name="bookmark" size={14} />
                <span>{label}</span>
              </button>
              {menu && (
                <div
                  className="proto-place-pop"
                  role="dialog"
                  aria-label="Saved reading place"
                  ref={popover}
                >
                  <button
                    type="button"
                    ref={removeButton}
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
            </div>
          )}
          {sentenceRect && (
            <span
              role="img"
              className="proto-place-sentence"
              aria-label="Listening resumes here"
              style={{
                top:
                  sentenceRect.top - scrollBox.top + scroll.scrollTop + sentenceRect.height / 2 - 2,
                left: sentenceRect.left - scrollBox.left - 10,
              }}
            />
          )}
        </>,
        host,
      )}
      {saved && place.continuing && (
        <button
          type="button"
          className="proto-continue"
          onClick={place.jump}
          aria-label={`Continue reading at ${saved.progress}%`}
        >
          <ProtoIcon name="bookmark" size={14} />
          <span>Continue · {saved.progress}%</span>
          <ProtoIcon name="chevronDown" size={13} />
        </button>
      )}
    </>
  );
}
