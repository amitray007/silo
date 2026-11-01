// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
import '@fontsource-variable/literata';
import './prototype.css';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import { SelectionPopover } from './controls';
import { inTextEntry, onControl, plain } from './protoKeys';
import { useHighlights } from './useHighlights';
import { useMockListen } from './useMockListen';
import { usePencil } from './usePencil';
import { useProseRoot } from './useProseRoot';
import { useReadAloud } from './useReadAloud';
import { type SavedPlaceApi, useSavedPlace } from './useSavedPlace';
import { useTypography } from './useTypography';
import { VariantA } from './VariantA';
import { VariantB } from './VariantB';
import { VariantC } from './VariantC';
import { useVariant, VariantSwitcher } from './VariantSwitcher';

export type Tools = {
  typo: ReturnType<typeof useTypography>;
  pencil: ReturnType<typeof usePencil>;
  hl: ReturnType<typeof useHighlights>;
  ra: ReturnType<typeof useReadAloud>;
  scroll: HTMLElement;
  panel: HTMLElement;
  prose: HTMLElement | null;
  host: HTMLElement;
  place?: SavedPlaceApi;
};

/**
 * THROWAWAY: three layouts for the Reader tools, switched with ?variant=A|B|C.
 * Mounted from ReaderPane only when import.meta.env.DEV. State lives in memory.
 */
export default function ReaderToolsPrototype({
  scrollRef,
  panelRef,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const [els, setEls] = useState<{ scroll: HTMLElement; panel: HTMLElement; host: HTMLElement }>();
  useEffect(() => {
    const scroll = scrollRef.current;
    const panel = panelRef.current;
    if (!scroll || !panel) return;
    const host = document.createElement('div');
    host.className = 'proto-overlay';
    scroll.append(host);
    setEls({ scroll, panel, host });
    return () => host.remove();
  }, [scrollRef, panelRef]);
  if (!els) return null;
  return <Mounted {...els} scrollRef={scrollRef} />;
}

function Mounted({
  scroll,
  panel,
  host,
  scrollRef,
}: {
  scroll: HTMLElement;
  panel: HTMLElement;
  host: HTMLElement;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const { variant, cycle } = useVariant();
  const prose = useProseRoot(scrollRef);
  const typo = useTypography(prose, panel);
  const [params] = useSearchParams();
  const pencil = usePencil(prose, scroll, host, {
    linkId: params.get('link'),
    persist: false,
  });
  const hl = useHighlights(prose, scroll);
  const realRa = useReadAloud(prose, scroll);
  const place = useSavedPlace(prose, scroll);
  const mockRa = useMockListen(prose, scroll, realRa, place);
  const ra = variant === 'B' ? mockRa : realRa;
  const previousPencil = useRef({ enabled: false, playing: false });
  useEffect(() => {
    const previous = previousPencil.current;
    if (
      variant === 'B' &&
      ((previous.enabled && !pencil.enabled) || (previous.playing && !pencil.playing))
    )
      place.save(pencil.currentBlock, 'pencil');
    previousPencil.current = { enabled: pencil.enabled, playing: pencil.playing };
  }, [variant, pencil.enabled, pencil.playing, pencil.currentBlock, place.save]);

  useEffect(() => {
    panel.dataset.protoVariant = variant;
    return () => {
      delete panel.dataset.protoVariant;
    };
  }, [panel, variant]);

  // Pencil keys win while the pencil is on; read-aloud keys apply while the player is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (inTextEntry(event) || !plain(event)) return;
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (pencil.enabled) {
        if (event.key === ' ' && !onControl(event)) {
          handled();
          pencil.toggle();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (
            event.target instanceof Element &&
            event.target.closest('[role="radiogroup"], select')
          )
            return;
          handled();
          pencil.move(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === '+' || event.key === '=') {
          handled();
          pencil.faster();
        } else if (event.key === '-' || event.key === '_') {
          handled();
          pencil.slower();
        }
        return;
      }
      if (!ra.active) return;
      if (event.key === ' ' && !onControl(event)) {
        handled();
        ra.toggle();
      } else if (event.key === 'ArrowRight' && !onControl(event)) {
        handled();
        ra.next();
      } else if (event.key === 'ArrowLeft' && !onControl(event)) {
        handled();
        ra.prev();
      } else if (event.key === '+' || event.key === '=') {
        handled();
        ra.faster();
      } else if (event.key === '-' || event.key === '_') {
        handled();
        ra.slower();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const tools: Tools = { typo, pencil, hl, ra, scroll, panel, prose, host, place };
  return (
    <>
      {pencil.overlay}
      {hl.supported
        ? null
        : createPortal(<p className="proto-warning">Custom Highlight API missing.</p>, host)}
      {variant !== 'B' && <SelectionPopover hl={hl} />}
      <VariantSwitcher variant={variant} cycle={cycle} />
      {variant === 'A' && <VariantA {...tools} />}
      {variant === 'B' && <VariantB {...tools} />}
      {variant === 'C' && <VariantC {...tools} />}
    </>
  );
}
