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
import { useRowMenu } from './RowMenuContext';
import { useLibrarySelection } from './SelectionContext';
import { TagOptionsList } from './TagOptionsList';

const labelStyle: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: '0.72rem',
  fontWeight: 500,
  color: 'var(--ghost)',
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
  padding: '8px 11px',
  outline: 'none',
  marginBottom: 13,
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
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 'calc(100% + 4px)',
        zIndex: 20,
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        boxShadow: '0 18px 50px -20px rgba(40,28,8,.45)',
        padding: 5,
        animation: 'siloIn .14s ease',
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
        placeholder="find or create a tag"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          margin: '0 0 3px',
          padding: '5px 9px',
          border: '1px solid var(--line)',
          borderRadius: 7,
          background: 'var(--bg2)',
          color: 'var(--ink)',
          font: 'inherit',
          fontSize: '0.78rem',
          outline: 'none',
        }}
      />
      <TagOptionsList opts={opts} hidden={hidden} size="md" onToggle={handleToggle} />
      {canCreate && (
        <button
          type="button"
          onClick={handleCreate}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            boxSizing: 'border-box',
            border: 0,
            background: 'none',
            fontFamily: 'inherit',
            textAlign: 'left',
            padding: '5px 9px',
            borderRadius: 6,
            fontSize: '0.78rem',
            fontWeight: 500,
            color: 'var(--mut)',
            cursor: 'pointer',
          }}
        >
          <span style={{ color: 'var(--ghost)' }}>+</span>
          <span>create "{trimmedQuery}"</span>
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
 * a11y: focus moves into the panel on open (the panel itself, `tabIndex={-1}`,
 * mirroring v3's `editRef`/`onKeyDown={trapKey}`), Tab is trapped inside via a
 * roving keydown handler, Escape closes, and closing returns focus to the
 * `⋯` trigger that opened it (browsers restore focus to `document.activeElement`
 * at time of open automatically once the modal unmounts IF that element is
 * still in the DOM — the row's `⋯` button never unmounts on close, so no
 * extra "restore focus" bookkeeping is needed beyond letting the browser do it;
 * we still capture + refocus explicitly below since the row can re-render
 * between open/close).
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

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement;
    panelRef.current?.focus();
    return () => {
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (tagsOpen) {
          setTagsOpen(false);
          setTagQuery('');
        } else {
          closeEdit();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [tagsOpen, closeEdit]);

  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = e.currentTarget;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, textarea, select',
      ),
    ).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
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
    // biome-ignore lint/a11y/useKeyWithClickEvents: scrim dismiss is pointer-only convenience — Escape (handled by the document listener above) is the keyboard-equivalent close path, matching v3.
    // biome-ignore lint/a11y/noStaticElementInteractions: same — a non-interactive click guard, not a control.
    <div
      onClick={closeEdit}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(24,17,7,.32)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 40,
        animation: 'siloFade .16s ease',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Edit item"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
        tabIndex={-1}
        style={{
          width: 520,
          maxWidth: 'calc(100vw - 48px)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          background: 'var(--bg)',
          padding: '21px 24px',
          boxShadow: '0 24px 60px -28px rgba(40,28,8,.35)',
          boxSizing: 'border-box',
          outline: 'none',
          animation: 'siloIn .16s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 15 }}>
          <span style={{ fontSize: '1rem', fontWeight: 500 }}>Edit</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--fnt)' }}>{deriveDomain(link.url)}</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeEdit}
            style={{
              fontFamily: 'inherit',
              fontSize: '0.66rem',
              color: 'var(--fnt)',
              border: '1px solid var(--line)',
              borderRadius: 5,
              padding: '2px 6px',
              background: 'var(--bg)',
              cursor: 'pointer',
            }}
          >
            esc
          </button>
        </div>

        <p style={labelStyle}>title</p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="how you'll look for it later"
          style={{ ...fieldStyle, fontWeight: 500 }}
        />

        <p style={labelStyle}>description</p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="what this is, in your words"
          style={{ ...fieldStyle, color: 'var(--mut)', fontSize: '0.82rem', resize: 'vertical' }}
        />

        <p style={labelStyle}>tags</p>
        <div style={{ position: 'relative', marginBottom: 13 }}>
          <button
            type="button"
            onClick={() => {
              setTagsOpen((open) => !open);
              setTagQuery('');
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 6,
              width: '100%',
              boxSizing: 'border-box',
              border: `1px solid ${tagsOpen ? 'var(--ghost)' : 'var(--line)'}`,
              borderRadius: 8,
              background: 'var(--bg2)',
              fontFamily: 'inherit',
              fontSize: '0.82rem',
              padding: '7px 11px',
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
                  gap: 5,
                  border: '1px solid var(--line)',
                  background: 'var(--bg)',
                  borderRadius: 999,
                  padding: '2px 9px',
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
                  title="remove"
                  style={{ color: 'var(--ghost)', cursor: 'pointer' }}
                >
                  ✕
                </span>
              </span>
            ))}
            {tags.length === 0 && <span style={{ color: 'var(--fnt)' }}>choose tags</span>}
            <span style={{ marginLeft: 'auto', color: 'var(--ghost)', fontSize: '0.72rem' }}>
              ▾
            </span>
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
          <span style={{ color: 'var(--markt)' }}>¶</span> note
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="why you kept it"
          style={{
            ...fieldStyle,
            color: 'var(--mut)',
            fontSize: '0.82rem',
            fontStyle: 'italic',
            resize: 'vertical',
            marginBottom: 0,
          }}
        />

        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 17 }}>
          <button
            type="button"
            onClick={handleTrash}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
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
            trash
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={closeEdit}
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
            cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              border: '1px solid var(--line)',
              background: 'var(--bg2)',
              borderRadius: 8,
              fontSize: '0.76rem',
              fontWeight: 500,
              color: 'var(--ink)',
              padding: '6px 16px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ color: 'var(--markt)' }}>✓</span>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
