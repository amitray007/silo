import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useCreateTag } from '../api/hooks';
import type { TagCount } from '../api/types';
import { useSidebarPagination } from '../lib/useSidebarPagination';
import { NavItem } from './NavItem';
import { ReaderIcon } from './reader/ReaderIcon';
import { SectionCaret } from './SectionCaret';
import { SidebarFindButton, SidebarFindEmpty, SidebarFindInput } from './SidebarFind';
import { SidebarRowSkeletonList } from './SidebarRowSkeleton';

/**
 * A `NavItemLink`-shaped callback the caller (`Sidebar`) supplies so this
 * component stays router-agnostic — it renders the tag row via `NavItem` but
 * lets the parent decide how "navigate to this tag" actually works (mirrors
 * `Sidebar.tsx`'s own `NavItemLink` wrapper, reused here instead of
 * duplicated).
 */
interface SidebarTagsProps {
  tags: TagCount[];
  activeTag?: string | undefined;
  /** True while `useTags()` is still loading (`Sidebar`'s own `isLoading`) — renders skeleton tag rows in place of `tags` (which is `[]` until it resolves) instead of a flash of empty. Defaults to `false` so existing callers/tests are unaffected. */
  loading?: boolean;
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
 */
export function SidebarTags({ tags, activeTag, loading = false, renderTagLink }: SidebarTagsProps) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem('silo.tagsExpanded') !== 'false';
    } catch {
      return true;
    }
  });
  const [findOpen, setFindOpen] = useState(false);
  const [autoFocusOnOpen, setAutoFocusOnOpen] = useState(false);
  const [query, setQuery] = useState('');
  const findButtonRef = useRef<HTMLButtonElement>(null);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagValue, setNewTagValue] = useState('');

  const newTagInputRef = useRef<HTMLInputElement>(null);
  const createTag = useCreateTag();

  useEffect(() => {
    if (newTagOpen) newTagInputRef.current?.focus();
  }, [newTagOpen]);

  function toggleTagFind() {
    setAutoFocusOnOpen(!findOpen && expanded);
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
  const page = useSidebarPagination(
    visibleTags.length,
    visibleTags.findIndex((tag) => tag.name.toLowerCase() === activeTag?.toLowerCase()),
    expanded,
    trimmedQuery,
  );

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
    <div className="silo-tags" data-expanded={expanded}>
      <div className="silo-tags-header">
        <div className="silo-tags-title">
          <button
            type="button"
            className="silo-tags-toggle"
            aria-expanded={expanded}
            aria-controls="silo-tag-list"
            onClick={() => {
              setAutoFocusOnOpen(false);
              setExpanded(!expanded);
              try {
                localStorage.setItem('silo.tagsExpanded', String(!expanded));
              } catch {
                /* Storage may be unavailable. */
              }
            }}
          >
            <span className="silo-tags-label">Tags</span>
            <SectionCaret expanded={expanded} />
          </button>
        </div>
        <span style={{ flex: 1 }} />
        <SidebarFindButton
          ref={findButtonRef}
          label="Find a tag"
          open={findOpen}
          onClick={toggleTagFind}
        />
      </div>

      {expanded && (
        <div id="silo-tag-list" className="silo-tags-body">
          {findOpen && (
            <SidebarFindInput
              value={query}
              onChange={setQuery}
              placeholder="Find tag"
              autoFocusOnOpen={autoFocusOnOpen}
              onClose={() => {
                setFindOpen(false);
                findButtonRef.current?.focus();
              }}
            />
          )}

          {loading && (
            <span className="silo-sr-only" role="status">
              Loading tags
            </span>
          )}
          <section
            ref={page.scrollRef}
            className="silo-tag-scroll"
            aria-label="Tags"
            aria-busy={loading}
          >
            {!loading && trimmedQuery && visibleTags.length === 0 && (
              <SidebarFindEmpty kind="tags" query={query} />
            )}
            {loading && tags.length === 0 ? (
              <SidebarRowSkeletonList kind="tags" />
            ) : (
              visibleTags.slice(0, page.visibleCount).map((tag) => renderTagLink(tag))
            )}
            {page.hasMore && (
              <div ref={page.sentinelRef} className="silo-sidebar-sentinel" aria-hidden="true" />
            )}
          </section>

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
                  fontSize: 'var(--sidebar-input-size, var(--text-sm))',
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
                  Couldn't create - try again
                </p>
              )}
            </>
          ) : (
            <NavItem
              title="New tag"
              variant="tag"
              label={<span style={{ color: 'inherit' }}>New tag</span>}
              icon={<ReaderIcon name="plus" />}
              onClick={openNewTag}
            />
          )}
        </div>
      )}
    </div>
  );
}
