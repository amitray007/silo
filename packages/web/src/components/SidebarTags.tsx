import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useCreateTag } from '../api/hooks';
import type { TagCount } from '../api/types';

/**
 * A `NavItemLink`-shaped callback the caller (`Sidebar`) supplies so this
 * component stays router-agnostic — it renders the tag row via `NavItem` but
 * lets the parent decide how "navigate to this tag" actually works (mirrors
 * `Sidebar.tsx`'s own `NavItemLink` wrapper, reused here instead of
 * duplicated).
 */
interface SidebarTagsProps {
  tags: TagCount[];
  renderTagLink: (tag: TagCount) => React.ReactNode;
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
 * hidden-scrollbar scroll region (`.silo-tag-scroll`, base.css) — a long tag
 * list scrolls independently instead of pushing Settings off-screen, and
 * nothing is hidden behind a click. Filtering (case-insensitive substring
 * match on `tagQ`) still narrows the list before it renders.
 */
export function SidebarTags({ tags, renderTagLink }: SidebarTagsProps) {
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
          padding: 'var(--s-0-5) var(--s2-5) var(--s1-5)',
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
        {/* Negative right margin cancels the button's own hit-target padding
            (`--s1`) so the 16px glyph's visual right edge lands flush with
            the row's right padding edge — the same flush-right baseline
            NavItem's meta counts sit on (direct user feedback: "search icon
            is not aligned well with the tag counts on the right"). The hit
            target itself stays full-sized (padding untouched), only the
            box's outer edge is pulled in. */}
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
            padding: 'var(--s1)',
            marginRight: 'calc(var(--s1) * -1)',
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
          `max-height` + hidden scrollbar (`.silo-tag-scroll`, base.css) so a
          long tag list scrolls in place instead of pushing Settings
          off-screen — every tag (or every filtered match) renders here, no
          truncation. */}
      <div className="silo-tag-scroll">{visibleTags.map((tag) => renderTagLink(tag))}</div>

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
            border: 0,
            background: 'none',
            fontFamily: 'inherit',
            textAlign: 'left',
            width: '100%',
            boxSizing: 'border-box',
            padding: '5px 10px',
            borderRadius: 8,
            fontSize: 'var(--text-base)',
            fontWeight: 400,
            color: 'var(--ink)',
            cursor: 'pointer',
          }}
        >
          + New tag
        </button>
      )}
    </div>
  );
}
