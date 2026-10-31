// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
import { useCallback, useEffect, useState } from 'react';
import { HighlightSheet, ListenSheet, NotePopover, NotesList, PencilSheet } from './BParts';
import { TypographyControls } from './controls';
import { MarginNotes } from './MarginNotes';
import { OutlineRail } from './OutlineRail';
import { ProtoIcon, type ProtoIconName } from './ProtoIcon';
import { ProtoSpinner, useDelayed } from './ProtoSpinner';
import { inTextEntry, plain, useEscapeClose } from './protoKeys';
import type { Tools } from './ReaderToolsPrototype';
import { SelectionBar } from './SelectionBar';
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
  title,
  active,
  badge,
  onClick,
  text,
}: {
  icon?: ProtoIconName;
  text?: string;
  label: string;
  title: string;
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
      title={title}
      onClick={onClick}
    >
      {icon ? <ProtoIcon name={icon} size={19} /> : <span className="proto-aa">{text}</span>}
      <span className="proto-dock-label">{label}</span>
      {badge ? <span className="proto-badge">{badge}</span> : null}
    </button>
  );
}

/** The sentence under a click, as an index into the read-aloud segments. */
function sentenceAt(event: MouseEvent, ra: Tools['ra']): number {
  const segments = ra.segments;
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }
  if (node) {
    const found = segments.findIndex((segment) =>
      segment.range.isPointInRange(node as Node, offset),
    );
    if (found >= 0) return found;
  }
  const target = event.target as Node;
  return segments.findIndex((segment) => segment.block.contains(target));
}

/** B: the head stays as it is; a floating dock opens sheets and turns into the player. */
export function VariantB({ typo, pencil, hl, ra, prose, scroll, panel, host }: Tools) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [color, setColor] = useState<HighlightColor>('yellow');
  const [openNote, setOpenNote] = useState<string | null>(null);
  const closeNote = useCallback(() => setOpenNote(null), []);
  const [hovered, setHovered] = useState<string | null>(null);
  useEscapeClose(sheet !== null && !openNote, () => setSheet(null));

  // Escape turns the pencil off once nothing above it (note, sheet, selection) is open.
  const pencilOff = pencil.setEnabled;
  useEffect(() => {
    if (!pencil.enabled || sheet !== null || openNote || hl.pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || inTextEntry(event)) return;
      if (document.querySelector('[data-reader-menu], .proto-listbox')) return;
      event.preventDefault();
      event.stopPropagation();
      pencilOff(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pencil.enabled, sheet, openNote, hl.pending, pencilOff]);

  // The hovered note and its passage brighten together.
  useEffect(() => {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return;
    const item = hl.items.find((entry) => entry.id === hovered);
    if (!item) {
      CSS.highlights.delete('proto-hover');
      return;
    }
    const mark = new Highlight(item.range);
    mark.priority = 10;
    CSS.highlights.set('proto-hover', mark);
    return () => {
      CSS.highlights.delete('proto-hover');
    };
  }, [hovered, hl.items]);

  // While the Highlight sheet is open, selecting text highlights it straight away.
  const { setAutoColor } = hl;
  useEffect(() => {
    if (sheet !== 'highlight') return;
    setAutoColor(color);
    return () => setAutoColor(null);
  }, [sheet, color, setAutoColor]);

  // "Add note" on a fresh selection opens the note popover on the new highlight.
  const { editing, setEditing } = hl;
  useEffect(() => {
    if (!editing) return;
    setOpenNote(editing);
    setEditing(null);
  }, [editing, setEditing]);

  const togglePencil = () => {
    if (pencil.enabled) pencil.setEnabled(false);
    else pencil.start();
  };

  const toggle = (next: Sheet) => {
    if (sheet === next) {
      setSheet(null);
      return;
    }
    setSheet(next);
    if (next === 'listen') ra.open();
  };

  // Clicks in the article: jump the voice while Listen is open, else open a note popover.
  useEffect(() => {
    if (!prose) return;
    const onClick = (event: MouseEvent) => {
      if (!window.getSelection()?.isCollapsed) return;
      if (event.target instanceof Element && event.target.closest('a, button, img')) return;
      if (ra.active) {
        const at = sentenceAt(event, ra);
        if (at >= 0) ra.startAt(at);
        return;
      }
      if (sheet === 'pencil') return;
      const hit = hl.items.find((item) =>
        Array.from(item.range.getClientRects()).some(
          (rect) =>
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        ),
      );
      if (hit) setOpenNote(hit.id);
    };
    const onMove = (event: MouseEvent) => {
      const hit = hl.items.find((item) =>
        Array.from(item.range.getClientRects()).some(
          (rect) =>
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom,
        ),
      );
      setHovered((previous) => (previous === (hit?.id ?? null) ? previous : (hit?.id ?? null)));
    };
    prose.addEventListener('click', onClick);
    prose.addEventListener('mousemove', onMove);
    return () => {
      prose.removeEventListener('click', onClick);
      prose.removeEventListener('mousemove', onMove);
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (inTextEntry(event) || !plain(event) || event.repeat) return;
      if (event.key === 'p') togglePencil();
      else if (event.key === 'l') toggle('listen');
      else if (event.key === 'h') toggle('highlight');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const player = ra.active;
  const spin = useDelayed(ra.status === 'loading' || (ra.playing && ra.buffering));
  const note = hl.items.find((item) => item.id === openNote);
  return (
    <>
      <OutlineRail prose={prose} scroll={scroll} panel={panel} items={hl.items} />
      <MarginNotes
        items={hl.items}
        prose={prose}
        scroll={scroll}
        host={host}
        hovered={hovered}
        setHovered={setHovered}
        onOpen={setOpenNote}
      />
      <SelectionBar
        hl={hl}
        prose={prose}
        color={color}
        setColor={setColor}
        title={scroll.querySelector('h2')?.textContent ?? document.title}
        listen={() => {
          ra.open();
          ra.startHere();
        }}
      />
      {note && (
        <NotePopover key={note.id} item={note} hl={hl} scroll={scroll} onClose={closeNote} />
      )}
      {sheet && (
        <section className="proto-sheet" aria-label={TITLES[sheet]} key={sheet}>
          <header>
            <h3>{TITLES[sheet]}</h3>
            <button
              type="button"
              className="silo-reader-iconbtn"
              aria-label="Close sheet"
              title="Close (Esc)"
              onClick={() => setSheet(null)}
            >
              <ProtoIcon name="close" />
            </button>
          </header>
          <div className="silo-reader-settings proto-sheet-body">
            {sheet === 'aa' && <TypographyControls typo={typo} />}
            {sheet === 'pencil' && <PencilSheet pencil={pencil} />}
            {sheet === 'highlight' && <HighlightSheet color={color} setColor={setColor} />}
            {sheet === 'listen' && <ListenSheet ra={ra} />}
            {sheet === 'notes' && (
              <NotesList
                hl={hl}
                onOpen={(id) => {
                  hl.jump(id);
                  setSheet(null);
                  setOpenNote(id);
                }}
              />
            )}
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
              title="Previous sentence (Left)"
              onClick={ra.prev}
            >
              <ProtoIcon name="prev" size={16} />
            </button>
            <button
              type="button"
              className="proto-play"
              aria-label={ra.playing ? 'Pause' : 'Play'}
              title={ra.playing ? 'Pause (Space)' : 'Play (Space)'}
              onClick={ra.toggle}
            >
              {spin ? (
                <ProtoSpinner size={16} />
              ) : (
                <ProtoIcon name={ra.playing ? 'pause' : 'play'} size={16} />
              )}
            </button>
            <button
              type="button"
              className="proto-step"
              aria-label="Next sentence"
              title="Next sentence (Right)"
              onClick={ra.next}
            >
              <ProtoIcon name="next" size={16} />
            </button>
            <span className="proto-now" data-empty={!ra.current}>
              {engineStatusLine(ra) ?? ra.current?.text ?? 'Ready'}
            </span>
            <button
              type="button"
              className="proto-text-btn"
              aria-label="Speed"
              title="Speed (+ / -)"
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
              title="Voice settings"
              aria-pressed={sheet === 'listen'}
              onClick={() => toggle('listen')}
            >
              <ProtoIcon name="list" size={16} />
            </button>
            <button
              type="button"
              className="proto-step"
              aria-label="Stop reading aloud"
              title="Stop"
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
              title="Typography"
              active={sheet === 'aa'}
              onClick={() => toggle('aa')}
            />
            <div className="proto-split" data-on={pencil.enabled}>
              <button
                type="button"
                className="proto-dockbtn"
                aria-pressed={pencil.enabled}
                aria-label="Pencil"
                title="Reading pencil (P)"
                onClick={togglePencil}
              >
                <ProtoIcon name="pencil" size={19} />
                <span className="proto-dock-label">Pencil</span>
              </button>
              <button
                type="button"
                className="proto-dockchev"
                aria-label="Pencil settings"
                title="Pencil settings"
                aria-expanded={sheet === 'pencil'}
                onClick={() => toggle('pencil')}
              >
                <ProtoIcon name="chevronDown" size={14} />
              </button>
            </div>
            <DockButton
              icon="highlighter"
              label="Highlight"
              title="Highlight (H)"
              active={sheet === 'highlight'}
              onClick={() => toggle('highlight')}
            />
            <DockButton
              icon="headphones"
              label="Listen"
              title="Read aloud (L)"
              active={false}
              onClick={() => toggle('listen')}
            />
            <DockButton
              icon="notes"
              label="Notes"
              title="Notes"
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
