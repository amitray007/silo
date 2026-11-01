import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReadingPositionJson } from '../../../api/types';
import { relativeTimeFromNow } from '../../../lib/relativeTime';
import { buildSegments, segmentIndexAt } from '../listen/segments';
import type { ReadAloudApi } from '../listen/useReadAloud';
import type { PencilApi } from '../pencil/usePencil';
import { ReaderIcon } from '../ReaderIcon';
import { withinFirstLine } from './geometry';
import { usePlaceGeometry } from './usePlaceGeometry';
import { usePlaceSpacing } from './usePlaceSpacing';
import { useSavedPlace } from './useSavedPlace';
import { articleWords, wordAtShare } from './words';

function inBridge(hover: Element | null, event: PointerEvent): boolean {
  if (!hover) return false;
  const range = document.createRange();
  range.selectNodeContents(hover);
  const first = range.getClientRects()[0];
  return Boolean(
    first &&
      event.clientX >= first.left - 30 &&
      event.clientX < first.left &&
      event.clientY >= first.top &&
      event.clientY <= first.bottom,
  );
}

function placeLabel(saved: ReadingPositionJson): string {
  const age = relativeTimeFromNow(saved.updatedAt);
  const yesterday =
    new Date(saved.updatedAt).toDateString() === new Date(Date.now() - 86400000).toDateString();
  const time = yesterday ? 'Yesterday' : age === 'just now' ? 'Just now' : age;
  return `${saved.source === 'listen' ? 'Stopped listening here' : 'Stopped here'} · ${time}`;
}

/** The one saved place, shared by manual marks, the Pencil and Listen. */
export function SavedPlace({
  prose,
  scroll,
  panel,
  saved,
  onSave,
  pencil,
  listen,
}: {
  prose: HTMLElement;
  scroll: HTMLElement;
  panel: HTMLElement;
  saved: ReadingPositionJson | null;
  onSave: (position: number | null) => Promise<void>;
  pencil: PencilApi;
  listen: ReadAloudApi;
}) {
  const place = useSavedPlace({ prose, scroll, saved, onSave });
  const { block, paragraphs, hover, setHover, save } = place;
  usePlaceSpacing(block, paragraphs, scroll);
  const { ribbon, preview } = usePlaceGeometry(prose, scroll, panel, block, hover);
  const [menu, setMenu] = useState(false);
  const [pop, setPop] = useState({ top: 0, left: 0 });
  const markButton = useRef<HTMLButtonElement>(null);
  const labelButton = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    panel.dataset.savedPlace = 'true';
    return () => {
      delete panel.dataset.savedPlace;
    };
  }, [panel]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.silo-place-ribbon')) return;
      if (inBridge(hover, event)) return;
      const paragraph = paragraphs.find(
        (el) => el.tagName === 'P' && el.contains(event.target as Node),
      );
      setHover(
        paragraph && paragraph !== block && withinFirstLine(paragraph, event.clientX, event.clientY)
          ? paragraph
          : null,
      );
    };
    const leave = () => setHover(null);
    scroll.addEventListener('pointermove', move);
    scroll.addEventListener('pointerleave', leave);
    scroll.addEventListener('scroll', leave, { passive: true });
    return () => {
      scroll.removeEventListener('pointermove', move);
      scroll.removeEventListener('pointerleave', leave);
      scroll.removeEventListener('scroll', leave);
    };
  }, [block, paragraphs, hover, setHover, scroll]);

  useEffect(() => {
    if (!menu) return;
    popover.current?.querySelector('button')?.focus({ preventScroll: true });
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
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const buttons = Array.from(popover.current?.querySelectorAll('button') ?? []);
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      markButton.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', outside);
    scroll.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', outside);
      scroll.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [menu, scroll]);

  const open = () => {
    const rect = markButton.current?.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    if (rect) {
      const dial = panel.querySelector('.silo-outline-cluster')?.getBoundingClientRect();
      setPop({
        left: Math.min(
          box.width - 252,
          Math.max(
            prose.getBoundingClientRect().left - box.left,
            (dial?.right ?? box.left) - box.left + 8,
          ),
        ),
        top: Math.max(52, Math.min(rect.bottom - box.top + 6, box.height - 168)),
      });
    }
    setMenu((value) => !value);
  };
  const label = saved ? placeLabel(saved) : '';
  const continuePencil = () => {
    listen.stop();
    place.dismiss();
    pencil.startFrom(saved?.position ?? 0);
    setMenu(false);
  };
  const continueListen = () => {
    pencil.stop();
    const word = wordAtShare(articleWords(prose), saved?.position ?? 0);
    const at = word
      ? segmentIndexAt(buildSegments(prose), word.startContainer, word.startOffset)
      : 0;
    place.dismiss();
    listen.startAt(Math.max(0, at));
    setMenu(false);
  };
  return (
    <>
      {createPortal(
        <>
          {saved && ribbon && (
            <div
              className="silo-place-ribbon-gutter"
              style={{ top: ribbon.top, left: ribbon.left }}
            >
              <button
                type="button"
                className="silo-place-ribbon"
                ref={markButton}
                aria-label={label}
                aria-expanded={menu}
                aria-haspopup="dialog"
                onClick={open}
              >
                <ReaderIcon name="bookmark" size={14} />
              </button>
              <i
                className="silo-place-elbow"
                aria-hidden="true"
                style={{
                  left: ribbon.elbowX,
                  top: ribbon.elbowY,
                  height: ribbon.top - ribbon.row - 10,
                }}
              />
              <div
                className="silo-place-ribbon-row"
                style={{ top: ribbon.row - ribbon.top, width: ribbon.width }}
              >
                <button
                  type="button"
                  className="silo-place-ribbon-label"
                  ref={labelButton}
                  aria-expanded={menu}
                  aria-haspopup="dialog"
                  onClick={open}
                >
                  {label}
                </button>
                <i className="silo-place-rule" aria-hidden="true" />
              </div>
            </div>
          )}
          {hover && preview && (
            <button
              type="button"
              className="silo-place-ribbon silo-place-ribbon-preview"
              style={{ top: preview.top, left: preview.left }}
              aria-label="Mark reading place"
              title="Mark reading place (B)"
              onClick={() => {
                save(hover);
                setMenu(false);
              }}
            >
              <ReaderIcon name="bookmark" size={14} />
            </button>
          )}
        </>,
        scroll,
      )}
      {createPortal(
        <>
          {menu && saved && (
            <div
              className="silo-place-pop"
              role="dialog"
              aria-label="Saved reading place"
              data-reader-menu
              ref={popover}
              style={pop}
            >
              <div className="silo-place-meta">{label}</div>
              <button type="button" onClick={continuePencil}>
                <ReaderIcon name="edit" size={15} />
                Continue with Pencil
              </button>
              <button type="button" onClick={continueListen}>
                <ReaderIcon name="headphones" size={15} />
                Listen from here
              </button>
              <button
                type="button"
                onClick={() => {
                  place.remove();
                  setMenu(false);
                }}
              >
                <ReaderIcon name="trash" size={15} />
                Remove
              </button>
            </div>
          )}
          {saved && place.continuing && (
            <button
              type="button"
              className="silo-continue"
              onClick={place.jump}
              aria-label={`Continue reading at ${Math.round(saved.position * 100)}%`}
            >
              <ReaderIcon name="bookmark" size={14} />
              <span>Continue · {Math.round(saved.position * 100)}%</span>
              <ReaderIcon name="down" size={13} />
            </button>
          )}
        </>,
        panel,
      )}
    </>
  );
}
