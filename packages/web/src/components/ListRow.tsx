import { type ReactNode, type SyntheticEvent, useRef, useState } from 'react';
import type { LinkJson } from '../api/types';
import { isFeedPost } from '../lib/isFeedPost';
import { relativeTimeFromNow } from '../lib/relativeTime';
import { deriveDomain, deriveTitleFromUrl } from '../lib/url';
import { useCompactLinks } from '../lib/useCompactLinks';
import { useTitleReveal } from '../lib/useTitleReveal';
import { Chip } from './Chip';
import { MenuPresence } from './MenuPresence';
import { ReaderIcon } from './reader/ReaderIcon';
import { useReaderSelection } from './reader/ReaderSelection';
import { ScrambleText } from './ScrambleText';

function RowNoteIcon({ notes, compact }: { notes: string | null; compact: boolean }) {
  if (!notes || !compact) return null;
  return (
    <span className="silo-row-note-icon" title="Has note">
      <ReaderIcon name="note" />
      <span className="silo-sr-only">Has note</span>
    </span>
  );
}

/** Shared row geometry; Library and Trash retain their own per-link actions. */
export function ListRow({
  link,
  menuOpen,
  toggleMenu,
  menu,
  onEnter,
  onLeave,
  onMenu,
  purge,
  children,
  onRemove,
  onDelete,
  busy = false,
  error,
}: {
  link: LinkJson;
  menuOpen: boolean;
  toggleMenu: () => void;
  menu: (anchor: HTMLElement | null) => ReactNode;
  onEnter?: (event: SyntheticEvent<HTMLElement>) => void;
  onLeave?: () => void;
  onMenu?: () => void;
  purge?: number;
  children?: ReactNode;
  onRemove: () => void;
  onDelete?: () => void;
  busy?: boolean;
  error?: string | undefined;
}) {
  const [compact] = useCompactLinks();
  const revealTitle = useTitleReveal(link);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const { hovered, enter, leave } = useRowHover(onEnter, onLeave);
  const reader = useReaderSelection();
  const domain = deriveDomain(link.url);
  const selected = reader?.selectedId === link.id;
  const actionTabIndex = !reader || selected ? 0 : -1;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus tracking only; the link and buttons inside carry the interaction.
    <span
      className="silo-row-wrap"
      ref={anchorRef}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
    >
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
        aria-current={reader?.selectedId === link.id ? 'true' : undefined}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !reader) return;
          event.preventDefault();
          reader.select(link.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu?.();
          toggleMenu();
        }}
      >
        <span className="silo-row-titleline">
          <span className="silo-row-iconwrap">
            <Chip domain={domain} />
          </span>
          <ScrambleText
            className="silo-row-title"
            text={link.title ?? deriveTitleFromUrl(link.url)}
            reveal={revealTitle}
          />
        </span>
        <span className="silo-row-meta">
          <span>{domain}</span>
          {hovered && <span className="silo-row-time">{relativeTimeFromNow(link.createdAt)}</span>}
          {link.captureStatus === 'enriching' && <span className="silo-sr-only">Capturing</span>}
          {purge !== undefined && (
            <span className="silo-row-purge" title={`Auto-deletes in ${purge} days`}>
              Purges in {purge} days
            </span>
          )}
        </span>
        {children}
        {link.notes && <span className="silo-row-note">"{link.notes}"</span>}
        <RowNoteIcon notes={link.notes} compact={compact} />
      </a>
      <RowActions
        link={link}
        actionTabIndex={actionTabIndex}
        busy={busy}
        purge={purge}
        onRemove={onRemove}
        onDelete={onDelete}
        menuOpen={menuOpen}
        toggleMenu={toggleMenu}
        onMenu={onMenu}
      />
      {error && (
        <span className="silo-toast" role="alert">
          {error}
        </span>
      )}
      <MenuPresence>{menu(anchorRef.current)}</MenuPresence>
    </span>
  );
}

function isInternalFocus(event: SyntheticEvent<HTMLElement>): boolean {
  const related = (event as { relatedTarget?: EventTarget | null }).relatedTarget;
  return (
    (event.type === 'focus' || event.type === 'blur') &&
    related instanceof Node &&
    event.currentTarget.contains(related)
  );
}

function useRowHover(
  onEnter: ((event: SyntheticEvent<HTMLElement>) => void) | undefined,
  onLeave: (() => void) | undefined,
) {
  const [hovered, setHovered] = useState(false);
  // Hover and focus belong to the whole row, actions included. Events that
  // bubble from the menu portal, or move between the row and its actions, are
  // not enter/leave.
  const enter = (event: SyntheticEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (isInternalFocus(event)) return;
    setHovered(true);
    onEnter?.(event);
  };
  const leave = (event: SyntheticEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (isInternalFocus(event)) return;
    setHovered(false);
    onLeave?.();
  };
  return { hovered, enter, leave };
}

function RowActions({
  link,
  actionTabIndex,
  busy,
  purge,
  onRemove,
  onDelete,
  menuOpen,
  toggleMenu,
  onMenu,
}: {
  link: LinkJson;
  actionTabIndex: number;
  busy: boolean;
  purge: number | undefined;
  onRemove: () => void;
  onDelete: (() => void) | undefined;
  menuOpen: boolean;
  toggleMenu: () => void;
  onMenu: (() => void) | undefined;
}) {
  const feedPost = isFeedPost(link);
  return (
    <span className="silo-row-actions">
      <button
        type="button"
        className="silo-reader-iconbtn"
        tabIndex={actionTabIndex}
        aria-label="Open original"
        title="Open original"
        onClick={(event) => {
          event.stopPropagation();
          window.open(link.url, '_blank', 'noopener,noreferrer');
        }}
      >
        <ReaderIcon name="arrowUpRight" />
      </button>
      {!feedPost && (
        <button
          type="button"
          className="silo-reader-iconbtn"
          tabIndex={actionTabIndex}
          aria-label={purge === undefined ? 'Move to trash' : 'Restore'}
          title={purge === undefined ? 'Move to trash' : 'Restore'}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <ReaderIcon name={purge === undefined ? 'trash' : 'restore'} />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="silo-reader-iconbtn"
          tabIndex={actionTabIndex}
          aria-label="Delete forever"
          title="Delete forever"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <ReaderIcon name="trash" />
        </button>
      )}
      {!feedPost && (
        <button
          type="button"
          className="silo-rowmore silo-reader-iconbtn"
          tabIndex={actionTabIndex}
          title="More actions"
          aria-label="More actions"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onMenu?.();
            toggleMenu();
          }}
        >
          <ReaderIcon name="more" />
        </button>
      )}
    </span>
  );
}
