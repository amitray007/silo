import { useEffect, useRef, useState } from 'react';
import { useAddTag, useRemoveTag, useRetryCapture, useTags, useTrashLink } from '../api/hooks';
import type { LinkJson } from '../api/types';
import { buildTagOptions } from '../lib/tagOptions';
import { TrashIcon } from './NavIcons';
import { useRowMenu } from './RowMenuContext';
import { useLibrarySelection } from './SelectionContext';
import { TagOptionsList, tagSearchFieldStyle } from './TagOptionsList';

const COPY_RESET_MS = 700;

/**
 * The menu item shell's base style — `active` (used by the "tags" trigger
 * while its fly-out is open) pins the `--hov` background on even without the
 * pointer there, matching how a disclosure control should read as "open".
 * Hover/focus feedback for the OTHER rows is handled by `MenuItem` below, not
 * here — inline styles have no `:hover` pseudo-class, so a per-row
 * `onMouseEnter`/`onMouseLeave`-driven `active` flag is what actually makes
 * the hover background happen (a review fix: an earlier version of this file
 * called `menuItemStyle()` with no argument for every row except "tags",
 * so only "tags" ever got the promised `--hov` hover treatment).
 */
function menuItemStyle(active = false): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--s2)',
    width: '100%',
    boxSizing: 'border-box',
    border: 0,
    background: active ? 'var(--hov)' : 'none',
    fontFamily: 'inherit',
    textAlign: 'left',
    padding: 'var(--s2) var(--s2-5)',
    borderRadius: 8,
    fontSize: '0.82rem',
    fontWeight: 500,
    color: 'var(--mut)',
    cursor: 'pointer',
    transform: 'scale(1)',
    transition: 'background 0.14s ease, transform 0.12s var(--ease-out)',
  };
}

/**
 * A menu row that tracks its OWN hover/focus state and applies `--hov` via
 * `menuItemStyle` — shared by every action below (open/copy/edit/trash) so
 * each doesn't have to re-wire its own `onMouseEnter`/`onMouseLeave` pair
 * (`TagOptionsList.tsx`'s row hover uses the same per-row local-state
 * pattern, for the same reason: no `:hover` pseudo-class on inline styles).
 * Renders as `<a>` when `href` is given (open-in-new-tab), a `<button>`
 * otherwise.
 */
function MenuItem({
  href,
  onClick,
  children,
}: {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const handlers = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocus: () => setHovered(true),
    onBlur: () => setHovered(false),
  };
  // Press feedback (Emil Kowalski's "buttons must feel responsive" — a
  // subtle `scale(0.97)` on press) uses the real CSS `:active` pseudo-class
  // (`.silo-menu-item`, base.css) rather than a JS-tracked boolean — review
  // fix (ce-julik-frontend-races): an earlier version tracked `pressed` via
  // onMouseDown/onMouseUp/onMouseLeave/onBlur, which a touch-and-drag-off or
  // a touch cancelled mid-gesture (`touchcancel`/`pointercancel`, neither of
  // which fires a matching `mouseup`) could leave stuck `true`. `:active` is
  // native, stateless, and can't get stuck.
  const style = menuItemStyle(hovered);

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener"
        onClick={onClick}
        className="silo-menu-item"
        style={{ ...style, textDecoration: 'none' }}
        {...handlers}
      >
        {children}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className="silo-menu-item" style={style} {...handlers}>
      {children}
    </button>
  );
}

/** The leading icon slot — fixed 16px so every row's label starts at the same x, whatever 14px SVG icon sits in it. */
const iconSlotStyle: React.CSSProperties = {
  flex: 'none',
  width: 16,
  height: 16,
  display: 'grid',
  placeItems: 'center',
  color: 'var(--ghost)',
};

function Divider() {
  return <div style={{ borderTop: '1px solid var(--line)', margin: 'var(--s1-5) var(--s1)' }} />;
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

/** An arrow escaping a square "window" corner — reads unambiguously as "open elsewhere" (open-in-new-tab), same 14px stroke set as every other RowMenu icon. */
function OpenIcon() {
  return (
    <MenuIcon>
      <path d="M6.8 9.2 13 3" />
      <path d="M9.2 3H13v3.8" />
      <path d="M11.3 8.7V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3.3" />
    </MenuIcon>
  );
}

/** Two overlapping rounded squares — the standard "copy/duplicate" glyph, offset enough at 14px to read as two distinct sheets rather than a smudge. */
function CopyIcon() {
  return (
    <MenuIcon>
      <rect x="5.6" y="5.6" width="7" height="7" rx="1.4" />
      <path d="M3.4 9.4V4.4a1.4 1.4 0 0 1 1.4-1.4h5" />
    </MenuIcon>
  );
}

/** A pencil with a distinct nib break (v.s. a single diagonal stroke) — reads as "edit" at a glance. */
function EditIcon() {
  return (
    <MenuIcon>
      <path d="M9.9 3.1a1.35 1.35 0 0 1 1.9 1.9l-6.6 6.6-2.5.6.6-2.5Z" />
      <path d="M8.6 4.4l2 2" />
    </MenuIcon>
  );
}

/** A circular-arrows "retry" glyph for the "Enrich"/"Re-enrich" action — same 14px stroke set as the other RowMenu icons above. */
function EnrichIcon() {
  return (
    <MenuIcon>
      <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6" />
      <path d="M13 3v3h-3" />
      <path d="M13 8a5 5 0 0 1-8.5 3.5L3 10" />
      <path d="M3 13v-3h3" />
    </MenuIcon>
  );
}

/** A hash/`#` glyph built from the same 14px stroke set as every other RowMenu icon — replaces the old lone-text `#` character next to "Tags" so it leads with a real icon, not a differently-weighted glyph borrowed from body type. */
function TagsIcon() {
  return (
    <MenuIcon>
      <path d="M5.9 2.6 4.3 13.4" />
      <path d="M11.7 2.6 10.1 13.4" />
      <path d="M2.6 6.2h10.8" />
      <path d="M2.2 9.8h10.8" />
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
      className="silo-popover"
      style={{
        position: 'absolute',
        right: 'calc(100% - 2px)',
        top: -6,
        width: 216,
        // Dark-craft raised-surface convention (tokens.md): floating panels
        // sit one step up from the page ground on `--bg2` + a hairline
        // `--line` edge — this popover renders inside `.silo-content`, which
        // is ITSELF `--bg2`, so a plain `--bg2` fill would vanish into its
        // parent; the app's own elevation ramp handles that (--elev-2's
        // shadow + this hairline border) rather than a third surface token.
        background: 'var(--bg2)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        // K6 (oat-conformance audit): sourced from the shared elevation ramp.
        boxShadow: 'var(--elev-2)',
        padding: 'var(--s1-5)',
        // Grows leftward from the "tags" trigger it's anchored to (its right
        // edge sits flush against the trigger's left edge) — not the popover's
        // own center, per review-animations-STANDARDS.md's origin-aware rule.
        transformOrigin: 'top right',
      }}
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find tag"
        className="silo-field"
        style={tagSearchFieldStyle('0 0 var(--s1)')}
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
 * The row `⋯` menu popover (plan 011, V3-4; icon/craft redesign per a direct
 * user-feedback polish pass — build brief item 11, deepened again below to
 * a full icon-set + right-click-to-open pass): a tags fly-out row, a
 * divider, open-in-new-tab, copy-link, a divider, edit, move-to-trash — the
 * SAME layout and action set throughout every pass, never restructured. One
 * consistent 14px SVG stroke icon set (an arrow-out-of-window for open, two
 * overlapping squares for copy, a broken-nib pencil for edit, a hash grid for
 * tags, all replacing earlier mismatched glyph weights/characters), roomier
 * padding/radii, and a `--hov` background on hover/focus so every row reads
 * as an obviously clickable target rather than flat text. Copy was lowercase
 * as a "v3" decision; superseded by the app-wide sentence-case decision (all
 * labels below now read `Tags`/`Open in new tab`/etc.). Rendered by
 * `LinkRow` while `useRowMenu().openMenuId === link.id` — opened either by
 * the row's `⋯` button OR a right-click anywhere on the row (`LinkRow`'s
 * `onContextMenu`, which suppresses the browser's native menu and calls the
 * same `toggleMenu`); the whole popover stops `mousedown`/`click` propagation
 * (mirrors v3's `onMouseDown={{ stop }}`) so clicking inside it never bubbles
 * to the row's `<a>` (no navigation) or to the document-level "click outside
 * closes the menu" listener.
 */
export function RowMenu({ link }: { link: LinkJson }) {
  const { closeMenu, openEdit } = useRowMenu();
  const selection = useLibrarySelection();
  const [tagsFlyOpen, setTagsFlyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const trashLink = useTrashLink(link.id);
  const retryCapture = useRetryCapture(link.id);
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

  const handleEnrich = () => {
    closeMenu();
    retryCapture.mutate();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: this popover's onClick only stops propagation (v3's "clicking inside the menu must not bubble to the row <a> or the document click-outside listener") — it is not itself an interactive control; every real action inside is a proper <button>/<a>.
    // biome-ignore lint/a11y/noStaticElementInteractions: same rationale — a non-interactive click/mousedown guard, not a control.
    <div
      className="silo-popover"
      onMouseDown={stop}
      onClick={stop}
      style={{
        position: 'absolute',
        right: 'var(--s2)',
        top: 'calc(100% - 3px)',
        zIndex: 30,
        width: 224,
        // Dark-craft raised-surface convention (tokens.md) — see the matching
        // comment on `TagsFlyout` above for why `--bg2` (not `--bg`) is
        // correct here even though this popover's own parent is `--bg2` too.
        background: 'var(--bg2)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        // K6 (oat-conformance audit): sourced from the shared elevation ramp.
        boxShadow: 'var(--elev-2)',
        padding: 'var(--s1-5)',
        // Anchored top-right to the row's `⋯` trigger — scales from there,
        // not center (review-animations-STANDARDS.md's origin-aware rule).
        transformOrigin: 'top right',
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
          aria-haspopup="true"
          aria-expanded={tagsFlyOpen}
          // Opens (never toggles-closed) on click. A real pointer click always
          // fires `mouseenter` on the wrapper div (line below) immediately
          // before `click` — that mouseenter already sets `tagsFlyOpen` true,
          // so a naive `(open) => !open` toggle here would immediately flip
          // it back to false on every single mouse click, making the flyout
          // un-openable by mouse (QA finding: reproduced with a real click,
          // not just RTL's bare `fireEvent.click` which skips the mouseenter
          // and so never caught this). Closing for mouse users is
          // `onMouseLeave` below; for keyboard users (no hover) this still
          // opens it on Enter/Space with no toggle-closed path needed since
          // Escape/click-outside close the whole row menu anyway.
          onClick={() => setTagsFlyOpen(true)}
          style={menuItemStyle(tagsFlyOpen)}
        >
          <span style={iconSlotStyle}>
            <TagsIcon />
          </span>
          <span>Tags</span>
          {link.tags.length > 0 && (
            <span style={{ fontSize: '0.72rem', color: 'var(--fnt)', fontWeight: 400 }}>
              {link.tags.length}
            </span>
          )}
          {/* A small SVG chevron (same 14px stroke set as every other RowMenu
              icon) pointing at the fly-out it discloses — replaces the old
              lone `◂` text character, which sat at a visibly different
              stroke weight than the icon set around it. */}
          <span style={{ marginLeft: 'auto', color: 'var(--ghost)', display: 'grid' }}>
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 3.5 5 8l5 4.5" />
            </svg>
          </span>
        </button>
        {tagsFlyOpen && <TagsFlyout link={link} />}
      </div>

      <Divider />

      <MenuItem href={link.url} onClick={closeMenu}>
        <span style={iconSlotStyle}>
          <OpenIcon />
        </span>
        <span>Open in new tab</span>
      </MenuItem>
      <MenuItem onClick={handleCopy}>
        <span style={iconSlotStyle}>
          <CopyIcon />
        </span>
        {/* `--ink`, not amber, for the "copied" confirmation — review fix
            (ce-frontend-design): amber (`--mark`/`--markt`) is reserved for
            the brand grain-dot only, never a control/feedback state, and the
            marks that used to justify `--markt` here (note/claude/enriching)
            were removed in this same polish pass. */}
        <span style={{ color: copied ? 'var(--ink)' : 'var(--mut)' }}>
          {copied ? 'Copied' : 'Copy link'}
        </span>
      </MenuItem>

      <Divider />

      <MenuItem onClick={handleEdit}>
        <span style={iconSlotStyle}>
          <EditIcon />
        </span>
        <span>Edit</span>
      </MenuItem>
      {/* Hidden (not disabled) once a link is `full` — there's nothing left
          to re-enrich, and "silence means complete" (CLAUDE.md) means a
          finished link shows no leftover chrome for an action it can't take,
          rather than a grayed-out row. Mirrors the `retry_capture` MCP tool
          so a user can do everything an agent can (agent-native parity). */}
      {link.captureStatus !== 'full' && (
        <MenuItem onClick={handleEnrich}>
          <span style={iconSlotStyle}>
            <EnrichIcon />
          </span>
          <span>{link.captureStatus === 'enriching' ? 'Re-enrich' : 'Enrich'}</span>
        </MenuItem>
      )}
      <MenuItem onClick={handleTrash}>
        <span style={iconSlotStyle}>
          <TrashIcon size={14} stroke="var(--ghost)" />
        </span>
        <span>Move to trash</span>
      </MenuItem>
    </div>
  );
}
