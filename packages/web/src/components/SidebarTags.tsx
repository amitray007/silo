import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useCreateTag } from '../api/hooks';
import type { TagCount } from '../api/types';
import { Skeleton } from './Skeleton';

/**
 * A `NavItemLink`-shaped callback the caller (`Sidebar`) supplies so this
 * component stays router-agnostic — it renders the tag row via `NavItem` but
 * lets the parent decide how "navigate to this tag" actually works (mirrors
 * `Sidebar.tsx`'s own `NavItemLink` wrapper, reused here instead of
 * duplicated).
 */
interface SidebarTagsProps {
  tags: TagCount[];
  /** True while `useTags()` is still loading (`Sidebar`'s own `isLoading`) — renders skeleton tag rows in place of `tags` (which is `[]` until it resolves) instead of a flash of empty. Defaults to `false` so existing callers/tests are unaffected. */
  loading?: boolean;
  renderTagLink: (tag: TagCount) => React.ReactNode;
}

/** Per-row label-line widths for the skeleton tag list — varied so the placeholder rows don't read as a mechanical striped pattern before real tag names land. */
const SKELETON_TAG_WIDTHS = ['50%', '65%', '40%', '60%', '55%'];

/**
 * One placeholder tag row, shaped exactly like a real tag `NavItem` (`tag`
 * variant, `NavItem.tsx`'s `VARIANT_STYLE.tag`): `padding: 7px var(--s2-5)`
 * (7px 10px), `gap: var(--s1-5)`, a left label line + a right-aligned count
 * block — so swapping this for the real tag row produces no layout shift.
 */
function SkeletonTagRow({ labelWidth }: { labelWidth: string }) {
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--s1-5)',
    padding: '7px var(--s2-5)',
  };
  return (
    <div style={rowStyle}>
      <Skeleton height={12} width={labelWidth} radius={4} />
      <span style={{ flex: 1 }} />
      <Skeleton width={14} height={10} radius={4} />
    </div>
  );
}

/**
 * The Tags section's interactive chrome (`docs/design/app/Silo-v3.html`,
 * lines 40-61 — `toggleTagFind`/`tagFindOpen`, `newTagClosed`/`newTagOpen`):
 * a `⌕` find-a-tag toggle that reveals a client-side filter input, a
 * scrollable tag list, and an inline `+ new tag` create flow. Extracted out
 * of `Sidebar` so that component doesn't have to carry the extra local state
 * on top of routing/counts — this owns everything about "the tags list as an
 * interactive tool", `Sidebar` just supplies the tag data + a link renderer.
 *
 * Redesign (direct user feedback): the tag list used to truncate to the
 * first `TAG_SHOWN` tags behind a "+N more" toggle. It now renders EVERY
 * tag (filtered set included) inside its own fixed-`max-height`,
 * soft-scrollbar scroll region (`.silo-tag-scroll`, base.css) — a long tag
 * list scrolls independently instead of pushing Settings off-screen, and
 * nothing is hidden behind a click. Filtering (case-insensitive substring
 * match on `tagQ`) still narrows the list before it renders.
 */
export function SidebarTags({ tags, loading = false, renderTagLink }: SidebarTagsProps) {
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagValue, setNewTagValue] = useState('');

  const findInputRef = useRef<HTMLInputElement>(null);
  const newTagInputRef = useRef<HTMLInputElement>(null);
  const createTag = useCreateTag();

  // Focus the filter input the moment it opens (v3's `tagFindRef`/`onClick`
  // focus behavior) — effect (not an inline autoFocus prop) so it re-focuses
  // every time the button re-opens it, not just on first mount.
  useEffect(() => {
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen]);

  useEffect(() => {
    if (newTagOpen) newTagInputRef.current?.focus();
  }, [newTagOpen]);

  function toggleTagFind() {
    setFindOpen((open) => {
      const next = !open;
      if (!next) setQuery('');
      return next;
    });
  }

  const trimmedQuery = query.trim().toLowerCase();
  const visibleTags = trimmedQuery
    ? tags.filter((tag) => tag.name.toLowerCase().includes(trimmedQuery))
    : tags;

  function openNewTag() {
    setNewTagOpen(true);
  }

  function closeNewTag() {
    setNewTagOpen(false);
    setNewTagValue('');
  }

  function submitNewTag() {
    const name = newTagValue.trim();
    if (!name) {
      closeNewTag();
      return;
    }
    // Close/clear only once the create actually SUCCEEDS. On failure the
    // input stays open with the typed value intact (so the user sees
    // something went wrong and can retry) instead of quietly disappearing
    // as if the tag had been created — a mutation error must never look
    // identical to success.
    createTag.mutate(name, {
      onSuccess: () => closeNewTag(),
    });
  }

  function onNewTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitNewTag();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeNewTag();
    }
  }

  return (
    <div>
      {/* Top padding trimmed (18px → --s-0-5) per user feedback: the
          SidebarDivider above the Tags section already provides the
          separation, so the large top gap was redundant. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          // Tighter header→first-row gap (bottom --s1-5 → --s1) to match
          // shiori's compact Tags rhythm — the header sits closer to the tag
          // rows it labels, reading as one group rather than a floating title.
          // The left edge is nudged 3px past the row padding so "Tags"
          // aligns with the visible start of the Trash icon stroke, not the
          // invisible edge of the 18px icon slot.
          padding: 'var(--s-0-5) var(--s2-5) var(--s1) calc(var(--s2-5) + 3px)',
        }}
      >
        {/* Bumped 0.7rem → 0.8rem (direct user feedback: "too small vs the
            search icon next to it") — the 16px icon dwarfed the old size;
            0.8rem balances against it while staying a step below the
            0.84rem row-text scale, so "Tags" still reads as a section
            label, not a row. */}
        <p
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--mut)',
            margin: 0,
            letterSpacing: '0.02em',
          }}
        >
          Tags
        </p>
        <span style={{ flex: 1 }} />
        {/* The search icon shares the SAME right inset as the tag counts below
            it: the header container and the NavItem tag rows both use --s2-5
            right padding, and here the icon button carries NO negative margin
            (removed) + zero right padding, so the 16px glyph's right edge lands
            exactly on the count column's right edge — one consistent right rail
            for "Tags 🔍" and every "# tag  N" below it (user feedback: align the
            count with the Tags heading). The extra hit area is added to the
            LEFT/vertical only, never the right, so it can't push the glyph off
            that rail. */}
        <button
          type="button"
          onClick={toggleTagFind}
          title="Find a tag"
          aria-label="Find a tag"
          aria-expanded={findOpen}
          className="silo-icon-btn-sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 0,
            background: 'none',
            borderRadius: 6,
            padding: 'var(--s1) 0 var(--s1) var(--s1)',
            color: findOpen ? 'var(--ink)' : 'var(--mut)',
            cursor: 'pointer',
          }}
        >
          {/* The real magnifier SVG (matching the Omnibar's), not the thin
              `⌕` Unicode glyph — that rendered undersized and inconsistent
              across platforms (user feedback: "too small … use a better
              search icon"). 16px, current stroke color. */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.3" />
            <path d="m10.3 10.3 3 3" />
          </svg>
        </button>
      </div>

      {findOpen && (
        <input
          ref={findInputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find tag"
          className="silo-field"
          style={{
            margin: '0 4px 3px',
            padding: '4px 8px',
            border: '1px solid var(--line)',
            borderRadius: 7,
            background: 'var(--bg)',
            color: 'var(--ink)',
            font: 'inherit',
            fontSize: 'var(--text-sm)',
            outline: 'none',
            width: 'calc(100% - 8px)',
            boxSizing: 'border-box',
            transition: 'border-color .15s ease',
          }}
        />
      )}

      {/* The scrollable tag-list region (fix, direct user feedback): a fixed
          `max-height` + soft custom scrollbar (`.silo-tag-scroll`, base.css) so a
          long tag list scrolls in place instead of pushing Settings
          off-screen — every tag (or every filtered match) renders here, no
          truncation. While `useTags()` is still loading (`tags` is `[]`),
          skeleton tag rows render in its place instead of a flash of empty —
          the "Tags" header + find button above stay visible throughout. */}
      <div className="silo-tag-scroll">
        {loading && tags.length === 0
          ? SKELETON_TAG_WIDTHS.map((width, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a static, never-reordered placeholder list
              <SkeletonTagRow key={i} labelWidth={width} />
            ))
          : visibleTags.map((tag) => renderTagLink(tag))}
      </div>

      {newTagOpen ? (
        <>
          <input
            ref={newTagInputRef}
            value={newTagValue}
            onChange={(event) => setNewTagValue(event.target.value)}
            onKeyDown={onNewTagKeyDown}
            onBlur={closeNewTag}
            placeholder="Tag name"
            className="silo-field"
            style={{
              margin: '2px 4px',
              padding: '4px 8px',
              border: '1px solid var(--line)',
              borderRadius: 7,
              background: 'var(--bg)',
              color: 'var(--ink)',
              font: 'inherit',
              fontSize: 'var(--text-sm)',
              outline: 'none',
              width: 'calc(100% - 8px)',
              boxSizing: 'border-box',
              transition: 'border-color .15s ease',
            }}
          />
          {createTag.isError && (
            <p
              style={{
                margin: '0 4px 3px',
                fontSize: 'var(--text-xs)',
                color: 'var(--warn)',
              }}
            >
              Couldn't create — try again
            </p>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={openNewTag}
          className="silo-sidebar-text-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s2-5)',
            border: 0,
            background: 'none',
            fontFamily: 'inherit',
            textAlign: 'left',
            width: '100%',
            boxSizing: 'border-box',
            padding: '5px var(--s2-5)',
            borderRadius: 8,
            fontSize: 'var(--text-base)',
            fontWeight: 400,
            color: 'var(--ink)',
            cursor: 'pointer',
          }}
        >
          {/* `+` in the same 18px icon slot as the tag `#` and the nav icons,
              so the whole Tags column shares one left ledger. Dim glyph
              (--ghost), bright label — matching shiori. */}
          <span
            style={{
              flex: 'none',
              display: 'grid',
              placeItems: 'center',
              width: 18,
              color: 'var(--ghost)',
            }}
          >
            +
          </span>
          <span>New tag</span>
        </button>
      )}
    </div>
  );
}
