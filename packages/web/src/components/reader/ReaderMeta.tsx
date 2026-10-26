import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useEditLink } from '../../api/hooks';
import type { LinkJson } from '../../api/types';
import { relativeTimeFromNow } from '../../lib/relativeTime';
import { deriveDomain } from '../../lib/url';
import { Chip } from '../Chip';
import { MenuPresence } from '../MenuPresence';
import { TagPicker, useLinkTags } from '../TagOptionsList';
import { ReaderIcon } from './ReaderIcon';

export function ReaderMeta({ link, trashed }: { link: LinkJson; trashed: boolean }) {
  const [tagOpen, setTagOpen] = useState(false);
  const membership = useLinkTags(link);
  return (
    <>
      <div className="silo-reader-byline">
        <div className="silo-reader-source">
          <Chip domain={deriveDomain(link.url)} size={16} />
          <span title={relativeTimeFromNow(link.createdAt)}>{deriveDomain(link.url)}</span>
          {link.addedBy === 'agent' && <span className="silo-reader-agent">◆ Added by Claude</span>}
          {link.captureStatus === 'enriching' && (
            <span className="silo-capturing">◌ Capturing</span>
          )}
        </div>
        <div className="silo-meta-strip">
          {membership.tags.map((tag) => (
            <span className="silo-meta-tag" key={tag}>
              <Link to={`/tags/${encodeURIComponent(tag)}`}>
                <span>#</span>
                {tag}
              </Link>
              {!trashed && (
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  disabled={membership.busy}
                  onClick={() => void membership.toggle(tag, true)}
                >
                  <ReaderIcon name="close" size={12} />
                </button>
              )}
            </span>
          ))}
          {!trashed && (
            <div className="silo-meta-tag-anchor">
              <button
                type="button"
                className="silo-meta-add"
                aria-haspopup="menu"
                aria-expanded={tagOpen}
                onClick={() => setTagOpen((open) => !open)}
              >
                <ReaderIcon name="plus" />
                Tag
              </button>
              <MenuPresence>
                {tagOpen && (
                  <TagPicker
                    membership={membership}
                    link={link}
                    className="silo-strip-picker"
                    onClose={() => setTagOpen(false)}
                  />
                )}
              </MenuPresence>
            </div>
          )}
        </div>
      </div>
      {membership.error && (
        <div className="silo-toast" role="alert">
          {membership.error}
        </div>
      )}
      <ReaderNote key={link.id} link={link} trashed={trashed} />
    </>
  );
}

function ReaderNote({ link, trashed }: { link: LinkJson; trashed: boolean }) {
  const edit = useEditLink(link.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(link.notes ?? '');
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [error, setError] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dismissed = useRef(false);
  const value = optimistic ?? link.notes ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh server note replaces the local optimistic value.
  useEffect(() => setOptimistic(null), [link.notes]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize after every draft change, once React has updated the textarea.
  useLayoutEffect(() => {
    if (!editing || !textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${textarea.current.scrollHeight}px`;
  }, [draft, editing]);
  useLayoutEffect(() => {
    if (editing) textarea.current?.focus();
  }, [editing]);
  const save = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    setEditing(false);
    if (draft === value) return;
    const previous = value;
    setOptimistic(draft);
    setError('');
    edit.mutate(
      { note: draft },
      {
        onSuccess: (result) => setOptimistic(result.link.notes ?? draft),
        onError: () => {
          setOptimistic(previous);
          setError("Couldn't save your note. Try again.");
        },
      },
    );
  };
  if (trashed && !value) return null;
  return (
    <>
      <div className={`silo-margin-note${value ? '' : ' is-empty'}`}>
        <div className="silo-note-label">
          <ReaderIcon name="note" />
          Note
        </div>
        {editing ? (
          <>
            <textarea
              ref={textarea}
              aria-label="Note"
              placeholder="Add a note..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={save}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  dismissed.current = true;
                  setEditing(false);
                }
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  save();
                }
              }}
            />
            <div className="silo-note-hint">esc cancel · ⌘↵ save · saves when you click away</div>
          </>
        ) : trashed ? (
          <div className="silo-note-text">{value}</div>
        ) : (
          <button
            type="button"
            className="silo-note-text"
            disabled={edit.isPending}
            aria-label={value ? 'Edit note' : 'Add a note'}
            onClick={() => {
              dismissed.current = false;
              setDraft(value);
              setEditing(true);
            }}
          >
            {value || 'Add a note...'}
          </button>
        )}
      </div>
      {error && (
        <div className="silo-toast" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
