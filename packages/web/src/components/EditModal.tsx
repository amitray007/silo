import { useEffect, useRef, useState } from 'react';
import {
  useAddTag,
  useCreateTag,
  useEditLink,
  useRemoveTag,
  useTags,
  useTrashLink,
} from '../api/hooks';
import type { LinkJson } from '../api/types';
import { buildTagOptions } from '../lib/tagOptions';
import { deriveDomain } from '../lib/url';
import { ModalHeader, ModalShell } from './ModalShell';
import { useRowMenu } from './RowMenuContext';
import { useLibrarySelection } from './SelectionContext';
import { TagOptionsList, tagSearchFieldStyle } from './TagOptionsList';

const labelStyle: React.CSSProperties = {
  margin: '0 0 var(--s1)',
  fontSize: '0.72rem',
  fontWeight: 500,
  color: 'var(--fnt)',
  letterSpacing: '0.02em',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--line)',
  borderRadius: 8,
  background: 'var(--bg2)',
  color: 'var(--ink)',
  font: 'inherit',
  fontSize: '0.85rem',
  // K3 (oat-conformance audit): 8px → var(--s2) exact; 11px → var(--s2-5)
  // (rounded to 10px, the nearest step).
  padding: 'var(--s2) var(--s2-5)',
  outline: 'none',
  marginBottom: 'var(--s3)',
};

/**
 * The tags picker's find-or-create fly-out (v3's `efTagsOpen` panel) — same
 * options logic as `RowMenu`'s `TagsFlyout` (`buildTagOptions`), plus a
 * "+ {name}" create row when the typed query doesn't match any existing tag.
 * Toggling an option here calls straight through to `useAddTag`/`useRemoveTag`
 * for THIS link (edits are per-link and don't wait for the modal's Save —
 * matches v3, where `eo.toggle` mutates `ef.tags` locally; here the write is
 * live, which keeps the two tag-mutation code paths — row menu vs. modal —
 * identical rather than inventing a second, buffered-until-save tag model).
 *
 * `assignedTags` is the MODAL's own local tag state (see `EditModal`'s doc
 * comment) — NOT read from the `link` prop directly. `link` is a snapshot
 * captured once at `openEdit()` time and never re-synced from the query
 * cache, so deriving "is this tag active" from `link.tags` would desync the
 * instant a toggle inside this very fly-out succeeds (a just-added tag
 * wouldn't show as active, a just-removed one would still show active) until
 * the whole modal were closed and reopened. `onToggled` is how this fly-out
 * reports a successful add/remove back up so `EditModal` can update that
 * local state immediately, independent of whatever the invalidated query
 * cache does in the background.
 */
function EditTagsFlyout({
  link,
  assignedTags,
  query,
  onQueryChange,
  onClose,
  onToggled,
}: {
  link: LinkJson;
  assignedTags: string[];
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
  onToggled: (name: string, nowActive: boolean) => void;
}) {
  const { data: tagsData } = useTags();
  const addTag = useAddTag(link.id);
  const removeTag = useRemoveTag(link.id);
  const createTag = useCreateTag();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const allTags = tagsData?.tags ?? [];
  const { opts, hidden } = buildTagOptions(allTags, assignedTags, query);
  const trimmedQuery = query.trim();
  const canCreate =
    trimmedQuery.length > 0 &&
    !allTags.some((t) => t.name.toLowerCase() === trimmedQuery.toLowerCase());

  const handleToggle = (name: string, active: boolean) => {
    if (active) {
      removeTag.mutate(name, { onSuccess: () => onToggled(name, false) });
    } else {
      addTag.mutate(name, { onSuccess: () => onToggled(name, true) });
    }
  };

  const handleCreate = () => {
    if (createTag.isPending) return;
    const name = trimmedQuery;
    createTag.mutate(name, {
      onSuccess: (result) => {
        addTag.mutate(result.name, { onSuccess: () => onToggled(result.name, true) });
      },
    });
    onQueryChange('');
  };

  return (
    <div
      className="silo-popover"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 'calc(100% + 4px)',
        zIndex: 20,
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        // K6 (oat-conformance audit): sourced from the shared elevation
        // ramp rather than a hardcoded rgba literal.
        boxShadow: 'var(--elev-2)',
        padding: 'var(--s1-5)',
        // Drops down from the full-width tags trigger directly above it — a
        // centered top origin reads correctly since the fly-out spans the
        // trigger's exact width (review-animations-STANDARDS.md's
        // origin-aware rule; center is right here because the "trigger" IS
        // the full width, unlike RowMenu's corner-anchored popovers).
        transformOrigin: 'top center',
      }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canCreate) {
            e.preventDefault();
            handleCreate();
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder="Find or create a tag"
        className="silo-field"
        // 3px has no clean --s* match (between --s-0-5/2px and --s1/4px) —
        // left un-tokenized rather than visibly nudging this fly-out's
        // internal spacing (K3, oat-conformance audit).
        style={tagSearchFieldStyle('0 0 3px')}
      />
      <TagOptionsList opts={opts} hidden={hidden} size="md" onToggle={handleToggle} />
      {canCreate && (
        <button
          type="button"
          onClick={handleCreate}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--s2)',
            width: '100%',
            boxSizing: 'border-box',
            border: 0,
            background: 'none',
            fontFamily: 'inherit',
            textAlign: 'left',
            padding: 'var(--s1-5) var(--s2)',
            borderRadius: 6,
            fontSize: '0.78rem',
            fontWeight: 500,
            color: 'var(--mut)',
            cursor: 'pointer',
          }}
        >
          <span style={{ color: 'var(--ghost)' }}>+</span>
          <span>Create "{trimmedQuery}"</span>
        </button>
      )}
    </div>
  );
}

/**
 * The edit modal (plan 011, V3-4) — matches `Silo-v3.html`'s `editOpen` block:
 * title/description/tags/note fields, footer trash/cancel/Save. Rendered by
 * `RowMenuProvider`'s consumer (`AppFrame`) whenever `useRowMenu().editingLink`
 * is non-null, so it's a SINGLE instance shared by every route (no
 * LibraryView/TagView duplication).
 *
 * Field edits are local (`title`/`description`/`note` only PATCH on Save,
 * matching v3's buffered `ef` state) but tag toggles are live (see
 * `EditTagsFlyout`'s doc comment). The chip list renders from LOCAL `tags`
 * state (initialized from `link.tags`, updated on each successful add/
 * remove/create) rather than from the `link` prop directly — `link` is a
 * one-time snapshot captured by `RowMenuContext.openEdit()` and never
 * re-synced from the query cache while the modal is open, so deriving the
 * chip list from `link.tags` would desync the instant a toggle inside this
 * very modal succeeds (see `EditTagsFlyout`'s doc comment for the concrete
 * failure this fixes).
 *
 * a11y (focus-trap, Escape, focus-restore-on-close) is all owned by the
 * shared `ModalShell` (see its doc comment) — this component only supplies
 * `handleClose` below, which layers Edit's own two-step Escape priority
 * (tags fly-out first) on top of `ModalShell`'s single Escape listener.
 */
export function EditModal({ link }: { link: LinkJson }) {
  const { closeEdit } = useRowMenu();
  const selection = useLibrarySelection();
  const [title, setTitle] = useState(link.title ?? '');
  const [description, setDescription] = useState(link.description ?? '');
  const [note, setNote] = useState(link.notes ?? '');
  const [tags, setTags] = useState(link.tags);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const removeTag = useRemoveTag(link.id);
  const editLink = useEditLink(link.id);
  const trashLink = useTrashLink(link.id);

  /** Applies a successful add/remove/create to the modal's own local tag list — see the class doc comment for why this can't just re-read `link.tags`. */
  const applyTagToggle = (name: string, nowActive: boolean) => {
    setTags((current) =>
      nowActive ? [...current.filter((t) => t !== name), name] : current.filter((t) => t !== name),
    );
  };

  /**
   * The single close semantics shared by ALL three dismiss affordances — the
   * Escape key + scrim click (both routed here by `ModalShell`) AND the
   * header's `esc` chip (`ModalHeader`'s `onClose`, also wired to this) — so
   * every way of "backing out" behaves identically: Edit needs a two-step
   * priority (close the tags fly-out first, only close the whole modal on a
   * second dismiss once the fly-out is already shut), matching the
   * row-menu-vs-selection Escape priority elsewhere in the app. Wrapping
   * `closeEdit` here preserves that behavior while still sharing `ModalShell`'s
   * scrim/focus-trap/Escape-listener wiring with `SettingsModal` (jscpd flagged
   * the two panels' shell code as duplicated before this was extracted).
   */
  const handleClose = () => {
    if (tagsOpen) {
      setTagsOpen(false);
      setTagQuery('');
    } else {
      closeEdit();
    }
  };

  const handleTrash = () => {
    // Drop this row from the Library selection if it was selected (review fix)
    // — same rationale as `RowMenu`'s trash: trashing individually removes the
    // row, so a stale selected id would drift the dock's count.
    selection.deselect([link.id]);
    trashLink.mutate();
    closeEdit();
  };

  const handleSave = () => {
    const patch: { title?: string; description?: string; note?: string } = {};
    if (title !== (link.title ?? '')) patch.title = title;
    if (description !== (link.description ?? '')) patch.description = description;
    if (note !== (link.notes ?? '')) patch.note = note;

    if (Object.keys(patch).length > 0) {
      editLink.mutate(patch);
    }
    closeEdit();
  };

  return (
    <ModalShell width={520} ariaLabel="Edit item" onClose={handleClose}>
      <ModalHeader
        title="Edit"
        onClose={handleClose}
        leading={
          <span style={{ fontSize: '0.78rem', color: 'var(--fnt)' }}>{deriveDomain(link.url)}</span>
        }
      />

      <p style={labelStyle}>Title</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="How you'll look for it later"
        className="silo-field"
        style={{ ...fieldStyle, fontWeight: 500 }}
      />

      <p style={labelStyle}>Description</p>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="What this is, in your words"
        className="silo-field"
        style={{ ...fieldStyle, color: 'var(--mut)', fontSize: '0.82rem', resize: 'vertical' }}
      />

      <p style={labelStyle}>Tags</p>
      <div style={{ position: 'relative', marginBottom: 'var(--s3)' }}>
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={tagsOpen}
          onClick={() => {
            setTagsOpen((open) => !open);
            setTagQuery('');
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--s1-5)',
            width: '100%',
            boxSizing: 'border-box',
            border: `1px solid ${tagsOpen ? 'var(--ghost)' : 'var(--line)'}`,
            borderRadius: 8,
            background: 'var(--bg2)',
            fontFamily: 'inherit',
            fontSize: '0.82rem',
            // 7px left un-tokenized (no clean --s* step between --s1-5/6px
            // and --s2/8px); 11px → var(--s2-5) (K3, oat-conformance audit).
            padding: '7px var(--s2-5)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--s1-5)',
                border: '1px solid var(--line)',
                background: 'var(--bg)',
                borderRadius: 999,
                padding: 'var(--s-0-5) var(--s2)',
                fontSize: '0.74rem',
                color: 'var(--ink)',
              }}
            >
              <span style={{ color: 'var(--ghost)' }}>#</span>
              {tag}
              {/** biome-ignore lint/a11y/useKeyWithClickEvents: this ✕ is inside a <button> that already toggles the fly-out on click/Enter/Space; the nested remove affordance is pointer-only by design (matches v3's chip ✕), keyboard users remove a tag via the fly-out's toggle list instead. */}
              {/** biome-ignore lint/a11y/noStaticElementInteractions: same — decorative remove glyph, not an independent control. */}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag.mutate(tag, { onSuccess: () => applyTagToggle(tag, false) });
                }}
                title="Remove"
                className="silo-tag-chip-remove"
                style={{ color: 'var(--ghost)', cursor: 'pointer' }}
              >
                ✕
              </span>
            </span>
          ))}
          {tags.length === 0 && <span style={{ color: 'var(--fnt)' }}>Choose tags</span>}
          <span style={{ marginLeft: 'auto', color: 'var(--ghost)', fontSize: '0.72rem' }}>▾</span>
        </button>
        {tagsOpen && (
          <EditTagsFlyout
            link={link}
            assignedTags={tags}
            query={tagQuery}
            onQueryChange={setTagQuery}
            onClose={() => {
              setTagsOpen(false);
              setTagQuery('');
            }}
            onToggled={applyTagToggle}
          />
        )}
      </div>

      <p style={labelStyle}>
        <span style={{ color: 'var(--markt)' }}>¶</span> Note
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Why you kept it"
        className="silo-field"
        style={{
          ...fieldStyle,
          color: 'var(--mut)',
          fontSize: '0.82rem',
          fontStyle: 'italic',
          resize: 'vertical',
          marginBottom: 0,
        }}
      />

      {/* K3 (oat-conformance audit): gap 14 → var(--s3-5) exact. marginTop
          17 is LEFT un-tokenized — nearest step is var(--s4)/16px, but that's
          a visible 1px shift on the footer's own top gap not worth risking
          in a token-migration-only pass. */}
      <div style={{ display: 'flex', gap: 'var(--s3-5)', alignItems: 'center', marginTop: 17 }}>
        <button
          type="button"
          onClick={handleTrash}
          className="silo-edit-footer-btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--s1-5)',
            border: 0,
            background: 'none',
            fontSize: '0.76rem',
            fontWeight: 500,
            color: 'var(--fnt)',
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
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
          Trash
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={closeEdit}
          className="silo-edit-footer-btn"
          style={{
            border: 0,
            background: 'none',
            fontSize: '0.76rem',
            fontWeight: 500,
            color: 'var(--mut)',
            padding: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="silo-edit-save-btn"
          style={{
            border: '1px solid var(--line)',
            background: 'var(--bg2)',
            borderRadius: 8,
            fontSize: '0.76rem',
            fontWeight: 500,
            color: 'var(--ink)',
            padding: 'var(--s1-5) var(--s4)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--s1-5)',
          }}
        >
          <span style={{ color: 'var(--markt)' }}>✓</span>
          Save
        </button>
      </div>
    </ModalShell>
  );
}
