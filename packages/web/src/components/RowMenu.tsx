import { useEffect, useRef, useState } from 'react';
import { useAddTag, useRemoveTag, useTags, useTrashLink } from '../api/hooks';
import type { LinkJson } from '../api/types';
import { buildTagOptions } from '../lib/tagOptions';
import { TrashIcon } from './NavIcons';
import { useRowMenu } from './RowMenuContext';
import { useLibrarySelection } from './SelectionContext';
import { TagOptionsList } from './TagOptionsList';

const COPY_RESET_MS = 700;

/**
 * The menu item shell — a `--hov`-tinted row on hover/focus rather than the
 * previous flat "no visible affordance until you actually mouse over it"
 * look, per the RowMenu redesign (build brief item 11: "the tags hover all
 * look bad … make it feel crafted"). `active` (used by the "tags" trigger
 * while its fly-out is open) pins the hover background on even without the
 * pointer there, matching how a disclosure control should read as "open".
 */
function menuItemStyle(active = false): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: '100%',
    boxSizing: 'border-box',
    border: 0,
    background: active ? 'var(--hov)' : 'none',
    fontFamily: 'inherit',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: '0.82rem',
    fontWeight: 500,
    color: 'var(--mut)',
    cursor: 'pointer',
  };
}

/** The leading icon slot — fixed 16px so every row's label starts at the same x, whatever icon (SVG or a lone glyph like `#`) sits in it. */
const iconSlotStyle: React.CSSProperties = {
  flex: 'none',
  width: 16,
  height: 16,
  display: 'grid',
  placeItems: 'center',
  color: 'var(--ghost)',
};

function Divider() {
  return <div style={{ borderTop: '1px solid var(--line)', margin: '5px 4px' }} />;
}

/** A small, consistent 14px stroke icon — shared sizing for every RowMenu action icon (open/copy/edit), so they read as one deliberate icon set rather than mismatched glyph sizes. */
function MenuIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function OpenIcon() {
  return (
    <MenuIcon>
      <path d="M6.5 9.5 13 3" />
      <path d="M8.5 3h4.5v4.5" />
      <path d="M11.5 8.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" />
    </MenuIcon>
  );
}

function CopyIcon() {
  return (
    <MenuIcon>
      <rect x="6" y="6" width="7.2" height="7.2" rx="1.3" />
      <path d="M3.8 9.8V3.7A1 1 0 0 1 4.8 2.7h6" />
    </MenuIcon>
  );
}

function EditIcon() {
  return (
    <MenuIcon>
      <path d="M10.2 2.9a1.3 1.3 0 0 1 1.9 1.9L4.8 12.1l-2.3.5.5-2.3Z" />
    </MenuIcon>
  );
}

/**
 * The tags fly-out (v3's left-positioned `menuTagsOpen` panel) — find-tag
 * input + toggle list + "+N more" note, opened via hover/click on the "tags"
 * row. Widened + roomier padding as part of the RowMenu polish pass (build
 * brief item 11) so it reads as an intentional sibling panel rather than a
 * cramped afterthought next to the redesigned main menu.
 */
function TagsFlyout({ link }: { link: LinkJson }) {
  const [query, setQuery] = useState('');
  const { data: tagsData } = useTags();
  const addTag = useAddTag(link.id);
  const removeTag = useRemoveTag(link.id);

  const { opts, hidden } = buildTagOptions(tagsData?.tags ?? [], link.tags, query);

  return (
    <div
      style={{
        position: 'absolute',
        right: 'calc(100% - 2px)',
        top: -6,
        width: 216,
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        boxShadow: '0 18px 50px -20px rgba(40,28,8,.45)',
        padding: 6,
        animation: 'siloIn .14s ease',
      }}
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="find tag"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          margin: '0 0 4px',
          padding: '6px 9px',
          border: '1px solid var(--line)',
          borderRadius: 7,
          background: 'var(--bg2)',
          color: 'var(--ink)',
          font: 'inherit',
          fontSize: '0.78rem',
          outline: 'none',
        }}
      />
      <TagOptionsList
        opts={opts}
        hidden={hidden}
        size="md"
        onToggle={(name, active) => (active ? removeTag.mutate(name) : addTag.mutate(name))}
      />
    </div>
  );
}

/**
 * The row `⋯` menu popover (plan 011, V3-4; redesigned per a direct
 * user-feedback polish pass — build brief item 11): a tags fly-out row, a
 * divider, open-in-new-tab, copy-link, a divider, edit, move-to-trash. Same
 * action set + lowercase copy as v3, but with a consistent 14px SVG icon set
 * (replacing the mismatched glyph characters `↗`/`⧉`/`✎`), roomier
 * padding/radii, and a `--hov` background on hover/focus so every row reads
 * as an obviously clickable target rather than flat text. Rendered by
 * `LinkRow` only while `useRowMenu().openMenuId === link.id`; the whole
 * popover stops `mousedown`/`click` propagation (mirrors v3's `onMouseDown={{
 * stop }}`) so clicking inside it never bubbles to the row's `<a>` (no
 * navigation) or to the document-level "click outside closes the menu"
 * listener.
 */
export function RowMenu({ link }: { link: LinkJson }) {
  const { closeMenu, openEdit } = useRowMenu();
  const selection = useLibrarySelection();
  const [tagsFlyOpen, setTagsFlyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const trashLink = useTrashLink(link.id);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(link.url).catch(() => {});
    setCopied(true);
    copyResetRef.current = setTimeout(() => setCopied(false), COPY_RESET_MS);
  };

  const handleTrash = () => {
    closeMenu();
    // Drop this row from the Library selection if it was selected (review
    // fix) — trashing it individually removes the row, and a stale id left in
    // the selection would inflate the dock's "N selected" count and could be
    // re-included in a later bulk action against a now-gone id.
    selection.deselect([link.id]);
    trashLink.mutate();
  };

  const handleEdit = () => {
    openEdit(link);
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: this popover's onClick only stops propagation (v3's "clicking inside the menu must not bubble to the row <a> or the document click-outside listener") — it is not itself an interactive control; every real action inside is a proper <button>/<a>.
    // biome-ignore lint/a11y/noStaticElementInteractions: same rationale — a non-interactive click/mousedown guard, not a control.
    <div
      onMouseDown={stop}
      onClick={stop}
      style={{
        position: 'absolute',
        right: 8,
        top: 'calc(100% - 3px)',
        zIndex: 30,
        width: 224,
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        boxShadow: '0 18px 50px -20px rgba(40,28,8,.45)',
        padding: 5,
        animation: 'siloIn .14s ease',
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover-open convenience only — the "tags" button below is already keyboard-operable (click toggles the fly-out) and owns all a11y semantics; this wrapper just widens the hover target v3-style. */}
      <div
        onMouseEnter={() => setTagsFlyOpen(true)}
        onMouseLeave={() => setTagsFlyOpen(false)}
        style={{ position: 'relative' }}
      >
        <button
          type="button"
          onClick={() => setTagsFlyOpen((open) => !open)}
          style={menuItemStyle(tagsFlyOpen)}
        >
          <span style={iconSlotStyle}>#</span>
          <span>tags</span>
          {link.tags.length > 0 && (
            <span style={{ fontSize: '0.72rem', color: 'var(--ghost)', fontWeight: 400 }}>
              {link.tags.length}
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: 'var(--ghost)', fontSize: '0.74rem' }}>◂</span>
        </button>
        {tagsFlyOpen && <TagsFlyout link={link} />}
      </div>

      <Divider />

      <a
        href={link.url}
        target="_blank"
        rel="noopener"
        onClick={closeMenu}
        style={{ ...menuItemStyle(), textDecoration: 'none' }}
      >
        <span style={iconSlotStyle}>
          <OpenIcon />
        </span>
        <span>open in new tab</span>
      </a>
      <button type="button" onClick={handleCopy} style={menuItemStyle()}>
        <span style={iconSlotStyle}>
          <CopyIcon />
        </span>
        <span style={{ color: copied ? 'var(--markt)' : 'var(--mut)' }}>
          {copied ? 'copied' : 'copy link'}
        </span>
      </button>

      <Divider />

      <button type="button" onClick={handleEdit} style={menuItemStyle()}>
        <span style={iconSlotStyle}>
          <EditIcon />
        </span>
        <span>edit</span>
      </button>
      <button type="button" onClick={handleTrash} style={menuItemStyle()}>
        <span style={iconSlotStyle}>
          <TrashIcon size={14} stroke="var(--ghost)" />
        </span>
        <span>move to trash</span>
      </button>
    </div>
  );
}
