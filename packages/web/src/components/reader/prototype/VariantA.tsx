// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
// biome-ignore-all lint/a11y/useAriaPropsSupportedByRole: throwaway prototype
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MenuPresence } from '../../MenuPresence';
import { MenuSurface } from '../../MenuSurface';
import { HighlightList, ListenTransport, PencilTransport, TypographyControls } from './controls';
import { ProtoIcon, type ProtoIconName } from './ProtoIcon';
import { inTextEntry, plain, useEscapeClose } from './protoKeys';
import type { Tools } from './ReaderToolsPrototype';
import type { EngineId } from './ttsEngine.prototype';
import { useAnchors } from './useAnchors';
import { engineStatusLine, RATES } from './useReadAloud';

function useHeadSlot(panel: HTMLElement) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const right = panel.querySelector('.silo-reader-right');
    if (!right) return;
    const el = document.createElement('div');
    el.className = 'proto-head-slot';
    right.prepend(el);
    setSlot(el);
    return () => el.remove();
  }, [panel]);
  return slot;
}

function HeadButton({
  icon,
  label,
  pressed,
  onClick,
  children,
}: {
  icon: ProtoIconName;
  label: string;
  pressed: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="silo-reader-iconbtn proto-headbtn"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <ProtoIcon name={icon} size={20} />
      {children}
    </button>
  );
}

/** A: every tool is an icon in the existing head; panels are popovers, a drawer and a mini player. */
export function VariantA({ typo, pencil, hl, ra, panel, scroll, prose, host }: Tools) {
  const slot = useHeadSlot(panel);
  const [aaOpen, setAaOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const anchors = useAnchors(hl.items, prose, scroll);
  useEscapeClose(drawer, () => setDrawer(false));
  const editing = hl.editing;
  useEffect(() => {
    if (editing) setDrawer(true);
  }, [editing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (inTextEntry(event) || !plain(event) || event.repeat) return;
      if (event.key === 'p') pencil.setEnabled(!pencil.enabled);
      else if (event.key === 'l') {
        if (ra.active) ra.stop();
        else ra.open();
      } else if (event.key === 'h') setDrawer((open) => !open);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const noted = hl.items.filter((item) => item.note);
  return (
    <>
      {slot &&
        createPortal(
          <>
            <div className="silo-reader-more">
              <button
                type="button"
                className="silo-reader-iconbtn proto-headbtn"
                aria-label="Reading settings"
                title="Reading settings"
                aria-expanded={aaOpen}
                aria-haspopup="dialog"
                onClick={() => setAaOpen(!aaOpen)}
              >
                <span className="proto-aa">Aa</span>
              </button>
              <MenuPresence>
                {aaOpen && (
                  <MenuSurface
                    className="silo-reader-more-menu silo-reader-settings proto-pop"
                    role="dialog"
                    label="Reading settings"
                    sheet={false}
                    onClose={() => setAaOpen(false)}
                  >
                    <h3>Typography</h3>
                    <TypographyControls typo={typo} />
                  </MenuSurface>
                )}
              </MenuPresence>
            </div>
            <HeadButton
              icon="pencil"
              label="Reading pencil (P)"
              pressed={pencil.enabled}
              onClick={() => pencil.setEnabled(!pencil.enabled)}
            />
            <HeadButton
              icon="highlighter"
              label="Highlights (H)"
              pressed={drawer}
              onClick={() => setDrawer(!drawer)}
            >
              {hl.items.length > 0 && <span className="proto-badge">{hl.items.length}</span>}
            </HeadButton>
            <HeadButton
              icon="headphones"
              label="Read aloud (L)"
              pressed={ra.active}
              onClick={() => (ra.active ? ra.stop() : ra.open())}
            />
            <span className="proto-head-sep" />
          </>,
          slot,
        )}

      {createPortal(
        noted.map((item) => {
          const anchor = anchors.find((entry) => entry.id === item.id);
          if (!anchor) return null;
          return (
            <button
              key={item.id}
              type="button"
              className="proto-dot"
              data-color={item.color}
              data-note={item.note}
              aria-label={`Note: ${item.note}`}
              style={{ top: anchor.top + 6, left: anchor.right + 10 }}
              onClick={() => {
                setDrawer(true);
                hl.setEditing(item.id);
              }}
            />
          );
        }),
        host,
      )}

      <aside className="proto-a-drawer" data-open={drawer} aria-label="Highlights" inert={!drawer}>
        <header>
          <h3>Highlights</h3>
          <span>{hl.items.length}</span>
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label="Close highlights"
            onClick={() => setDrawer(false)}
          >
            <ProtoIcon name="close" />
          </button>
        </header>
        <div className="proto-drawer-body">
          <HighlightList hl={hl} />
        </div>
      </aside>

      {(pencil.enabled || ra.active) && (
        <div className="proto-a-bottom">
          {pencil.enabled && (
            <div className="proto-bar" aria-label="Reading pencil">
              <ProtoIcon name="pencil" size={16} />
              <PencilTransport pencil={pencil} bare />
              <button
                type="button"
                className="proto-step"
                aria-label="Hide pencil"
                onClick={() => pencil.setEnabled(false)}
              >
                <ProtoIcon name="close" size={14} />
              </button>
            </div>
          )}
          {ra.active && (
            <div className="proto-bar" aria-label="Read aloud">
              <ListenTransport ra={ra}>
                <span className="proto-now" data-empty={!ra.current}>
                  {engineStatusLine(ra) ??
                    ra.current?.text ??
                    'Press play, or click a paragraph and use From here.'}
                </span>
                <button type="button" className="proto-text-btn" onClick={ra.startHere}>
                  From here
                </button>
                <select
                  className="proto-select"
                  aria-label="Speed"
                  value={ra.rate}
                  onChange={(event) => ra.setRate(Number(event.target.value))}
                >
                  {RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}x
                    </option>
                  ))}
                </select>
                <select
                  className="proto-select proto-voice"
                  aria-label="Voice engine"
                  value={ra.engineId}
                  onChange={(event) => ra.setEngine(event.target.value as EngineId)}
                >
                  {ra.engines.map((engine) => (
                    <option key={engine.id} value={engine.id}>
                      {engine.label}
                    </option>
                  ))}
                </select>
                <select
                  className="proto-select proto-voice"
                  aria-label="Voice"
                  value={ra.voiceId}
                  onChange={(event) => ra.setVoiceId(event.target.value)}
                >
                  <option value="">Default voice</option>
                  {ra.voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="proto-step"
                  aria-label="Close player"
                  onClick={ra.stop}
                >
                  <ProtoIcon name="close" size={14} />
                </button>
              </ListenTransport>
            </div>
          )}
        </div>
      )}
    </>
  );
}
