import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useCreateTag } from '../api/hooks';
import type { TagCount } from '../api/types';

/** v3's sidebar tag-list truncation threshold (`Silo-v3.html`'s `tagShown`). */
const TAG_SHOWN = 10;

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
 * lines 40-61 — `toggleTagFind`/`tagFindOpen`, `moreTags`/`toggleTagList`,
 * `newTagClosed`/`newTagOpen`): a `⌕` find-a-tag toggle that reveals a
 * client-side filter input, `+N more` truncation to the first `TAG_SHOWN`
 * tags, and an inline `+ new tag` create flow. Extracted out of `Sidebar` so
 * that component doesn't have to carry five extra pieces of local state on
 * top of routing/counts — this owns everything about "the tags list as an
 * interactive tool", `Sidebar` just supplies the tag data + a link renderer.
 *
 * Filtering and truncation compose in the v3-specified order: the raw tag
 * list is filtered by `tagQ` first (case-insensitive substring match), and
 * ONLY when no filter is active does the `+N more` truncation apply — a
 * filtered result set always shows every match, however many, matching v3's
 * behavior (filtering already narrows the list, so there's nothing left to
 * truncate).
 */
export function SidebarTags({ tags, renderTagLink }: SidebarTagsProps) {
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
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
  const filtered = trimmedQuery
    ? tags.filter((tag) => tag.name.toLowerCase().includes(trimmedQuery))
    : tags;

  const isFiltering = trimmedQuery.length > 0;
  const hasMore = !isFiltering && tags.length > TAG_SHOWN;
  const visibleTags = hasMore && !showAll ? filtered.slice(0, TAG_SHOWN) : filtered;
  const moreCount = tags.length - TAG_SHOWN;

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
      <div style={{ display: 'flex', alignItems: 'center', padding: '18px 10px 5px' }}>
        <p
          style={{
            fontSize: '0.7rem',
            fontWeight: 500,
            color: 'var(--ghost)',
            margin: 0,
            letterSpacing: '0.02em',
          }}
        >
          Tags
        </p>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={toggleTagFind}
          title="find a tag"
          aria-label="find a tag"
          aria-expanded={findOpen}
          className="silo-icon-btn-sm"
          style={{
            border: 0,
            background: 'none',
            borderRadius: 6,
            fontFamily: 'inherit',
            padding: '2px 3px',
            fontSize: '1.15rem',
            lineHeight: 1,
            color: findOpen ? 'var(--ink)' : 'var(--ghost)',
            cursor: 'pointer',
          }}
        >
          ⌕
        </button>
      </div>

      {findOpen && (
        <input
          ref={findInputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="find tag"
          className="silo-field"
          style={{
            margin: '0 4px 3px',
            padding: '4px 8px',
            border: '1px solid var(--line)',
            borderRadius: 7,
            background: 'var(--bg)',
            color: 'var(--ink)',
            font: 'inherit',
            fontSize: '0.78rem',
            outline: 'none',
            width: 'calc(100% - 8px)',
            boxSizing: 'border-box',
            transition: 'border-color .15s ease',
          }}
        />
      )}

      {visibleTags.map((tag) => renderTagLink(tag))}

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="silo-sidebar-text-btn"
          style={{
            border: 0,
            background: 'none',
            fontFamily: 'inherit',
            textAlign: 'left',
            width: '100%',
            boxSizing: 'border-box',
            padding: '4px 10px',
            borderRadius: 8,
            fontSize: '0.76rem',
            fontWeight: 400,
            color: 'var(--fnt)',
            cursor: 'pointer',
          }}
        >
          {showAll ? 'show less' : `+${moreCount} more`}
        </button>
      )}

      {newTagOpen ? (
        <>
          <input
            ref={newTagInputRef}
            value={newTagValue}
            onChange={(event) => setNewTagValue(event.target.value)}
            onKeyDown={onNewTagKeyDown}
            onBlur={closeNewTag}
            placeholder="tag name"
            className="silo-field"
            style={{
              margin: '2px 4px',
              padding: '4px 8px',
              border: '1px solid var(--line)',
              borderRadius: 7,
              background: 'var(--bg)',
              color: 'var(--ink)',
              font: 'inherit',
              fontSize: '0.8rem',
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
                fontSize: '0.7rem',
                color: 'var(--warn)',
              }}
            >
              couldn't create — try again
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
            fontSize: '0.84rem',
            fontWeight: 400,
            color: 'var(--fnt)',
            cursor: 'pointer',
          }}
        >
          + new tag
        </button>
      )}
    </div>
  );
}
