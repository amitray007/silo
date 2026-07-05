import { useEffect, useRef, useState } from 'react';
import { useAddTag, useRemoveTag, useTags, useTrashLink } from '../api/hooks';
import type { LinkJson } from '../api/types';
import { buildTagOptions } from '../lib/tagOptions';
import { useRowMenu } from './RowMenuContext';
import { TagOptionsList } from './TagOptionsList';

const COPY_RESET_MS = 700;

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  boxSizing: 'border-box',
  border: 0,
  background: 'none',
  fontFamily: 'inherit',
  textAlign: 'left',
  padding: '7px 10px',
  borderRadius: 7,
  fontSize: '0.78rem',
  fontWeight: 500,
  color: 'var(--mut)',
  cursor: 'pointer',
};

const iconSlotStyle: React.CSSProperties = {
  flex: 'none',
  width: 15,
  textAlign: 'center',
  color: 'var(--ghost)',
  fontSize: '0.78rem',
};

function Divider() {
  return <div style={{ borderTop: '1px solid var(--line)', margin: '4px 3px' }} />;
}

/** The tags fly-out (v3's left-positioned `menuTagsOpen` panel) — find-tag input + toggle list + "+N more" note, opened via hover/click on the "tags" row. */
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
        width: 200,
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        boxShadow: '0 18px 50px -20px rgba(40,28,8,.45)',
        padding: 5,
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
          margin: '0 0 3px',
          padding: '4px 8px',
          border: '1px solid var(--line)',
          borderRadius: 7,
          background: 'var(--bg2)',
          color: 'var(--ink)',
          font: 'inherit',
          fontSize: '0.76rem',
          outline: 'none',
        }}
      />
      <TagOptionsList
        opts={opts}
        hidden={hidden}
        size="sm"
        onToggle={(name, active) => (active ? removeTag.mutate(name) : addTag.mutate(name))}
      />
    </div>
  );
}

/**
 * The row `⋯` menu popover (plan 011, V3-4) — matches
 * `Silo-v3.html`'s `menuOpen` block exactly: a tags fly-out row, a divider,
 * open-in-new-tab, copy-link, a divider, edit, move-to-trash. Rendered by
 * `LinkRow` only while `useRowMenu().openMenuId === link.id`; the whole
 * popover stops `mousedown`/`click` propagation (mirrors v3's `onMouseDown={{
 * stop }}`) so clicking inside it never bubbles to the row's `<a>` (no
 * navigation) or to the document-level "click outside closes the menu"
 * listener.
 */
export function RowMenu({ link }: { link: LinkJson }) {
  const { closeMenu, openEdit } = useRowMenu();
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
          style={{
            ...menuItemStyle,
            background: tagsFlyOpen ? 'var(--hov)' : 'none',
          }}
        >
          <span style={iconSlotStyle}>#</span>
          <span>tags</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--ghost)', fontWeight: 400 }}>
            {link.tags.length || ''}
          </span>
          <span style={{ marginLeft: 'auto', color: 'var(--ghost)', fontSize: '0.72rem' }}>◂</span>
        </button>
        {tagsFlyOpen && <TagsFlyout link={link} />}
      </div>

      <Divider />

      <a
        href={link.url}
        target="_blank"
        rel="noopener"
        onClick={closeMenu}
        style={{ ...menuItemStyle, textDecoration: 'none' }}
      >
        <span style={iconSlotStyle}>↗</span>
        <span>open in new tab</span>
      </a>
      <button type="button" onClick={handleCopy} style={menuItemStyle}>
        <span style={iconSlotStyle}>⧉</span>
        <span style={{ color: copied ? 'var(--markt)' : 'var(--mut)' }}>
          {copied ? 'copied' : 'copy link'}
        </span>
      </button>

      <Divider />

      <button type="button" onClick={handleEdit} style={menuItemStyle}>
        <span style={iconSlotStyle}>✎</span>
        <span>edit</span>
      </button>
      <button type="button" onClick={handleTrash} style={menuItemStyle}>
        <span style={{ flex: 'none', width: 15, display: 'grid', placeItems: 'center' }}>
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="var(--ghost)"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2.8 4.2h10.4" />
            <path d="M6 4.2V2.8h4v1.4" />
            <path d="M4.3 4.2l.6 9h6.2l.6-9" />
            <path d="M6.6 7v3.8M9.4 7v3.8" />
          </svg>
        </span>
        <span>move to trash</span>
      </button>
    </div>
  );
}
