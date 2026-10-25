import { type ReactNode, type SyntheticEvent, useRef, useState } from 'react';
import type { LinkJson } from '../api/types';
import { relativeTimeFromNow } from '../lib/relativeTime';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';
import { useCompactLinks } from '../lib/useCompactLinks';
import { Chip } from './Chip';
import { RowSelectCheckbox } from './RowSelectCheckbox';
import { ReaderIcon } from './reader/ReaderIcon';
import { useReaderSelection } from './reader/ReaderSelection';
import type { SelectionScope } from './SelectionContext';

function RowNoteIcon({ notes, compact }: { notes: string | null; compact: boolean }) {
  if (!notes || !compact) return null;
  return (
    <span className="silo-row-note-icon" title="Has note">
      <ReaderIcon name="note" />
    </span>
  );
}

/** Shared row geometry; Library and Trash retain their own actions and selection. */
export function ListRow({
  link,
  selection,
  menuOpen,
  toggleMenu,
  menu,
  onEnter,
  onLeave,
  onMenu,
  purge,
  children,
  onRemove,
  busy = false,
  error,
}: {
  link: LinkJson;
  selection: SelectionScope;
  menuOpen: boolean;
  toggleMenu: () => void;
  menu: (anchor: HTMLElement | null) => ReactNode;
  onEnter?: (event: SyntheticEvent<HTMLAnchorElement>) => void;
  onLeave?: () => void;
  onMenu?: () => void;
  purge?: number;
  children?: ReactNode;
  onRemove: () => void;
  busy?: boolean;
  error?: string | undefined;
}) {
  const [compact] = useCompactLinks();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const reader = useReaderSelection();
  const selected = selection.isSelected(link.id);
  const showCheck = hovered || menuOpen || selection.selected.length > 0;
  const domain = deriveDomain(link.url);
  const enter = (event: SyntheticEvent<HTMLAnchorElement>) => {
    setHovered(true);
    onEnter?.(event);
  };
  const leave = () => {
    setHovered(false);
    onLeave?.();
  };
  return (
    <span className="silo-row-wrap" ref={anchorRef}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener"
        className="silo-link-row"
        data-link-id={link.id}
        data-compact={compact}
        data-enriching={link.captureStatus === 'enriching'}
        tabIndex={reader?.selectedId && reader.selectedId !== link.id ? -1 : 0}
        data-active={reader?.selectedId === link.id}
        data-trashed={purge !== undefined}
        aria-current={reader?.selectedId === link.id ? 'true' : undefined}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !reader) return;
          event.preventDefault();
          reader.select(link.id);
        }}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu?.();
          toggleMenu();
        }}
        style={selected ? { background: 'var(--sel)' } : undefined}
      >
        <span className="silo-row-titleline">
          <RowSelectCheckbox
            visible={showCheck}
            isSelected={selected}
            onToggle={() => selection.toggle(link.id)}
          />
          {!showCheck && <Chip domain={domain} />}
          <span className="silo-row-title">{link.title ?? deriveTitleFromUrl(link.url)}</span>
        </span>
        <span className="silo-row-meta">
          <span>{domain}</span>
          {hovered && <span className="silo-row-time">{relativeTimeFromNow(link.createdAt)}</span>}
          {link.captureStatus === 'enriching' && <span className="silo-capturing">Capturing</span>}
          {purge !== undefined && (
            <span className="silo-row-purge" title={`Auto-deletes in ${purge} days`}>
              Purges in {purge} days
            </span>
          )}
        </span>
        {children}
        {link.notes && <span className="silo-row-note">"{link.notes}"</span>}
        <RowNoteIcon notes={link.notes} compact={compact} />
        <span className="silo-row-actions">
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label="Open original"
            title="Open original"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              window.open(link.url, '_blank', 'noopener,noreferrer');
            }}
          >
            <ReaderIcon name="external" />
          </button>
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label={purge === undefined ? 'Move to trash' : 'Restore'}
            title={purge === undefined ? 'Move to trash' : 'Restore'}
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }}
          >
            <ReaderIcon name={purge === undefined ? 'trash' : 'restore'} />
          </button>
          <button
            type="button"
            className="silo-rowmore silo-reader-iconbtn"
            title="Options"
            aria-label="Options"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMenu?.();
              toggleMenu();
            }}
          >
            ⋯
          </button>
        </span>
      </a>
      {error && (
        <span className="silo-toast" role="alert">
          {error}
        </span>
      )}
      {menu(anchorRef.current)}
    </span>
  );
}
