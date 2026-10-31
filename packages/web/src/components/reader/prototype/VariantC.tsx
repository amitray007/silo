import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HighlightCard, ListenControls, PencilControls, TypographyControls } from './controls';
import { ProtoIcon, type ProtoIconName } from './ProtoIcon';
import { inTextEntry, plain, useEscapeClose } from './protoKeys';
import type { Tools } from './ReaderToolsPrototype';
import { useAnchors } from './useAnchors';

type Tool = 'aa' | 'pencil' | 'notes' | 'listen';

const TITLES: Record<Tool, string> = {
  aa: 'Typography',
  pencil: 'Reading pencil',
  notes: 'Highlights and notes',
  listen: 'Read aloud',
};
const PANEL = 320;
const RAIL = 44;
const LANE = 264;

function RailButton({
  icon,
  text,
  label,
  active,
  badge,
  onClick,
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
      className="proto-railbtn"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon ? <ProtoIcon name={icon} size={20} /> : <span className="proto-aa">{text}</span>}
      {badge ? <span className="proto-badge">{badge}</span> : null}
    </button>
  );
}

/** C: a rail on the right edge, a docked panel that shifts the text, and notes in the margin. */
export function VariantC({ typo, pencil, hl, ra, panel, scroll, prose, host }: Tools) {
  const [tool, setTool] = useState<Tool | null>(null);
  const anchors = useAnchors(hl.items, prose, scroll);
  const lane = useRef<HTMLDivElement>(null);
  useEscapeClose(tool !== null, () => setTool(null));

  const docked = tool !== null && tool !== 'notes';
  const margin =
    tool === 'notes' ||
    (tool === null && hl.items.some((item) => item.note || item.id === hl.editing));
  const pad = RAIL + (docked ? PANEL : 0) + (margin ? LANE : 0);
  useEffect(() => {
    panel.style.setProperty('--proto-c-pad', `${pad}px`);
    return () => {
      panel.style.removeProperty('--proto-c-pad');
    };
  }, [panel, pad]);

  const open = (next: Tool) => {
    if (tool === next) {
      setTool(null);
      return;
    }
    setTool(next);
    if (next === 'pencil') pencil.setEnabled(true);
    if (next === 'listen') ra.open();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (inTextEntry(event) || !plain(event) || event.repeat) return;
      if (event.key === 'p') open('pencil');
      else if (event.key === 'l') open('listen');
      else if (event.key === 'h') open('notes');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const shown = hl.items.filter((item) => tool === 'notes' || item.note || item.id === hl.editing);

  // Stack the margin cards at their passage and push overlapping ones down, like comments.
  useLayoutEffect(() => {
    const cards = Array.from(lane.current?.querySelectorAll<HTMLElement>('.proto-card') ?? []);
    let floor = 0;
    for (const card of cards) {
      const anchor = anchors.find((entry) => entry.id === card.dataset.id);
      const top = Math.max(anchor?.top ?? 0, floor);
      card.style.top = `${top}px`;
      floor = top + card.offsetHeight + 8;
    }
  });

  return (
    <>
      {margin &&
        createPortal(
          <div className="proto-lane" ref={lane} style={{ right: 6, width: LANE - 14 }}>
            {shown.map((item) => (
              <HighlightCard key={item.id} item={item} hl={hl} aligned />
            ))}
          </div>,
          host,
        )}

      <nav className="proto-rail" aria-label="Reader tools">
        <RailButton
          text="Aa"
          label="Typography"
          active={tool === 'aa'}
          onClick={() => open('aa')}
        />
        <RailButton
          icon="pencil"
          label="Reading pencil (P)"
          active={tool === 'pencil' || pencil.enabled}
          onClick={() => open('pencil')}
        />
        <RailButton
          icon="highlighter"
          label="Highlights and notes (H)"
          active={tool === 'notes'}
          badge={hl.items.length}
          onClick={() => open('notes')}
        />
        <RailButton
          icon="headphones"
          label="Read aloud (L)"
          active={tool === 'listen' || ra.active}
          onClick={() => open('listen')}
        />
      </nav>

      {docked && tool && (
        <aside
          className="proto-c-panel silo-reader-settings"
          aria-label={TITLES[tool]}
          style={{ width: PANEL }}
        >
          <header>
            <h3>{TITLES[tool]}</h3>
            <button
              type="button"
              className="silo-reader-iconbtn"
              aria-label="Close panel"
              onClick={() => setTool(null)}
            >
              <ProtoIcon name="close" />
            </button>
          </header>
          <div className="proto-c-body">
            {tool === 'aa' && <TypographyControls typo={typo} />}
            {tool === 'pencil' && <PencilControls pencil={pencil} />}
            {tool === 'listen' && <ListenControls ra={ra} upcoming={12} />}
          </div>
        </aside>
      )}
    </>
  );
}
