import { type ComponentType, createContext, useContext, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { MenuPresence } from '../../MenuPresence';
import { MenuSurface } from '../../MenuSurface';
import { TypeSheet } from './TypeSheet';

type DockTool = {
  id: string;
  label: string;
  title: string;
  /** The glyph beside the label. */
  glyph: string;
  sheet: ComponentType;
};

/** Later slices add their tools here; the dock lists only tools that have shipped. */
const tools: readonly DockTool[] = [
  { id: 'type', label: 'Type', title: 'Type settings', glyph: 'Aa', sheet: TypeSheet },
];

/** The element that holds the dock: the reader pane, so the dock floats over its scroll area. */
export const DockHostContext = createContext<HTMLElement | null>(null);

function DockButton({
  tool,
  open,
  sheetId,
  onToggle,
}: {
  tool: DockTool;
  open: boolean;
  sheetId: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="silo-reader-dockbtn"
      title={tool.title}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? sheetId : undefined}
      onClick={onToggle}
    >
      <span className="silo-reader-dock-glyph" aria-hidden="true">
        {tool.glyph}
      </span>
      {tool.label}
    </button>
  );
}

/** A floating pill at the bottom of the reader pane. Each tool opens a sheet above it. */
export function ReaderDock() {
  const host = useContext(DockHostContext);
  const [openId, setOpenId] = useState<string | null>(null);
  const sheetId = useId();
  if (!host) return null;
  const openTool = tools.find((tool) => tool.id === openId);
  const Sheet = openTool?.sheet;
  return createPortal(
    <div className="silo-reader-dock">
      <div className="silo-reader-dock-pill" role="toolbar" aria-label="Reader tools">
        {tools.map((tool) => (
          <DockButton
            key={tool.id}
            tool={tool}
            open={openId === tool.id}
            sheetId={sheetId}
            onToggle={() => setOpenId(openId === tool.id ? null : tool.id)}
          />
        ))}
      </div>
      <MenuPresence>
        {openTool && Sheet && (
          <MenuSurface
            className="silo-type-sheet"
            role="dialog"
            label={openTool.label}
            sheet={false}
            onClose={() => setOpenId(null)}
          >
            <div id={sheetId}>
              <Sheet />
            </div>
          </MenuSurface>
        )}
      </MenuPresence>
    </div>,
    host,
  );
}
