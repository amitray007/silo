import { useEffect, useState } from 'react';
import {
  ColorDots,
  HighlightList,
  ListenControls,
  PencilControls,
  TypographyControls,
} from './controls';
import { ProtoIcon, type ProtoIconName } from './ProtoIcon';
import { inTextEntry, plain, useEscapeClose } from './protoKeys';
import type { Tools } from './ReaderToolsPrototype';
import type { HighlightColor } from './useHighlights';
import { engineStatusLine, RATES } from './useReadAloud';

type Sheet = 'aa' | 'pencil' | 'highlight' | 'listen' | 'notes';

const TITLES: Record<Sheet, string> = {
  aa: 'Typography',
  pencil: 'Reading pencil',
  highlight: 'Highlight',
  listen: 'Read aloud',
  notes: 'Notes',
};

function DockButton({
  icon,
  label,
  active,
  badge,
  onClick,
  text,
}: {
  icon?: ProtoIconName;
  text?: string;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="proto-dockbtn"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
    >
      {icon ? <ProtoIcon name={icon} size={19} /> : <span className="proto-aa">{text}</span>}
      <span className="proto-dock-label">{label}</span>
      {badge ? <span className="proto-badge">{badge}</span> : null}
    </button>
  );
}

/** B: the head stays as it is; a floating dock opens sheets and turns into the player. */
export function VariantB({ typo, pencil, hl, ra }: Tools) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [color, setColor] = useState<HighlightColor>('yellow');
  useEscapeClose(sheet !== null, () => setSheet(null));

  // While the Highlight sheet is open, selecting text highlights it straight away.
  const { setAutoColor } = hl;
  useEffect(() => {
    if (sheet !== 'highlight') return;
    setAutoColor(color);
    return () => setAutoColor(null);
  }, [sheet, color, setAutoColor]);

  const toggle = (next: Sheet) => {
    if (sheet === next) {
      setSheet(null);
      return;
    }
    setSheet(next);
    if (next === 'pencil') pencil.setEnabled(true);
    if (next === 'listen') ra.open();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (inTextEntry(event) || !plain(event) || event.repeat) return;
      if (event.key === 'p') toggle('pencil');
      else if (event.key === 'l') toggle('listen');
      else if (event.key === 'h') toggle('highlight');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const player = ra.active;
  return (
    <>
      {sheet && (
        <section className="proto-sheet" aria-label={TITLES[sheet]} key={sheet}>
          <header>
            <h3>{TITLES[sheet]}</h3>
            <button
              type="button"
              className="silo-reader-iconbtn"
              aria-label="Close sheet"
              onClick={() => setSheet(null)}
            >
              <ProtoIcon name="close" />
            </button>
          </header>
          <div className="silo-reader-settings proto-sheet-body">
            {sheet === 'aa' && <TypographyControls typo={typo} />}
            {sheet === 'pencil' && <PencilControls pencil={pencil} />}
            {sheet === 'highlight' && (
              <div className="proto-stack">
                <div className="silo-reader-settings-row">
                  <span>Colour</span>
                  <ColorDots value={color} onPick={setColor} label="Highlight colour" />
                </div>
                <p className="silo-reader-settings-helper">
                  Select any text and it is highlighted in this colour at once. Add notes from the
                  Notes sheet.
                </p>
              </div>
            )}
            {sheet === 'listen' && <ListenControls ra={ra} upcoming={4} />}
            {sheet === 'notes' && <HighlightList hl={hl} />}
          </div>
        </section>
      )}

      <div
        className="proto-dock"
        data-mode={player ? 'player' : 'tools'}
        role="toolbar"
        aria-label="Reader tools"
      >
        {player ? (
          <>
            <button
              type="button"
              className="proto-step"
              aria-label="Previous sentence"
              onClick={ra.prev}
            >
              <ProtoIcon name="prev" size={16} />
            </button>
            <button
              type="button"
              className="proto-play"
              aria-label={ra.playing ? 'Pause' : 'Play'}
              onClick={ra.toggle}
            >
              <ProtoIcon name={ra.playing ? 'pause' : 'play'} size={16} />
            </button>
            <button
              type="button"
              className="proto-step"
              aria-label="Next sentence"
              onClick={ra.next}
            >
              <ProtoIcon name="next" size={16} />
            </button>
            <span className="proto-now" data-empty={!ra.current}>
              {engineStatusLine(ra) ??
                ra.current?.text ??
                'Press play, or open settings and start from here.'}
            </span>
            <button
              type="button"
              className="proto-text-btn"
              aria-label="Speed"
              onClick={() =>
                ra.setRate(
                  RATES[(RATES.indexOf(ra.rate as (typeof RATES)[number]) + 1) % RATES.length] ?? 1,
                )
              }
            >
              {ra.rate}x
            </button>
            <button
              type="button"
              className="proto-step"
              aria-label="Read aloud settings"
              aria-pressed={sheet === 'listen'}
              onClick={() => toggle('listen')}
            >
              <ProtoIcon name="list" size={16} />
            </button>
            <button
              type="button"
              className="proto-step"
              aria-label="Stop reading aloud"
              onClick={() => {
                ra.stop();
                if (sheet === 'listen') setSheet(null);
              }}
            >
              <ProtoIcon name="close" size={16} />
            </button>
          </>
        ) : (
          <>
            <DockButton
              text="Aa"
              label="Type"
              active={sheet === 'aa'}
              onClick={() => toggle('aa')}
            />
            <DockButton
              icon="pencil"
              label="Pencil"
              active={sheet === 'pencil' || pencil.enabled}
              onClick={() => toggle('pencil')}
            />
            <DockButton
              icon="highlighter"
              label="Highlight"
              active={sheet === 'highlight'}
              onClick={() => toggle('highlight')}
            />
            <DockButton
              icon="headphones"
              label="Listen"
              active={false}
              onClick={() => toggle('listen')}
            />
            <DockButton
              icon="notes"
              label="Notes"
              active={sheet === 'notes'}
              badge={hl.items.length}
              onClick={() => toggle('notes')}
            />
          </>
        )}
      </div>
    </>
  );
}
