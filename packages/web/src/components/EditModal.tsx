import { useEffect, useRef, useState } from 'react';
import { useEditLink, useTrashLink } from '../api/hooks';
import type { LinkJson } from '../api/types';
import { deriveDomain } from '../lib/url';
import { Chip } from './Chip';
import { ModalHeader, ModalShell } from './ModalShell';
import { useRowMenu } from './RowMenuContext';
import { ReaderIcon } from './reader/ReaderIcon';
import { TagTokenField, useLinkTags } from './TagOptionsList';

export function EditModal({
  link,
  focus = 'title',
}: {
  link: LinkJson;
  focus?: 'title' | 'note' | 'tags';
}) {
  const { closeEdit } = useRowMenu();
  const [title, setTitle] = useState(link.title ?? '');
  const [description, setDescription] = useState(link.description ?? '');
  const [note, setNote] = useState(link.notes ?? '');
  const [tagsOpen, setTagsOpen] = useState(focus === 'tags');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const tags = useLinkTags(link);
  const edit = useEditLink(link.id);
  const trash = useTrashLink(link.id);
  const domain = deriveDomain(link.url);
  const busy = edit.isPending || trash.isPending;
  useEffect(() => {
    if (focus === 'note') noteRef.current?.focus();
    if (focus === 'tags') document.getElementById('edit-tags')?.focus();
  }, [focus]);
  const close = () => {
    if (busy) return;
    if (tagsOpen) {
      setTagsOpen(false);
      document.getElementById('edit-tags')?.blur();
    } else closeEdit();
  };
  const save = () => {
    if (busy) return;
    const patch: { title?: string; description?: string; note?: string } = {};
    if (title !== (link.title ?? '')) patch.title = title;
    if (description !== (link.description ?? '')) patch.description = description;
    if (note !== (link.notes ?? '')) patch.note = note;
    if (!Object.keys(patch).length) {
      closeEdit();
      return;
    }
    edit.mutate(patch, {
      onSuccess: closeEdit,
      onError: () => setError("Couldn't save this link. Try again."),
    });
  };
  return (
    <ModalShell
      width={448}
      ariaLabel="Edit link"
      onClose={close}
      maxHeight="calc(100dvh - 32px)"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          save();
        }
      }}
    >
      <ModalHeader title="Edit link" onClose={close} />
      <div className="silo-url-card">
        <Chip domain={domain} size={18} />
        <div className="silo-url-text">
          <b>{domain}</b>
          <span title={link.url}>{link.url}</span>
        </div>
        <button
          type="button"
          className="silo-reader-iconbtn"
          aria-label={copied ? 'Link copied' : 'Copy link'}
          onClick={() => {
            navigator.clipboard
              .writeText(link.url)
              .then(() => setCopied(true))
              .catch(() => setError("Couldn't copy the link"));
          }}
        >
          <ReaderIcon name="copy" />
        </button>
        <a
          className="silo-reader-iconbtn"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open original"
        >
          <ReaderIcon name="external" />
        </a>
      </div>
      <div className="silo-modal-body silo-edit-fields">
        <div className="silo-edit-field">
          <label htmlFor="edit-title">Title</label>
          <input
            id="edit-title"
            className="silo-field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="How you'll look for it later"
          />
        </div>
        <div className="silo-edit-field">
          <label htmlFor="edit-tags">Tags</label>
          <TagTokenField membership={tags} open={tagsOpen} onOpenChange={setTagsOpen} />
        </div>
        <div className="silo-edit-field">
          <label htmlFor="edit-note">
            Note <span>Why you kept it · {note.length} characters</span>
          </label>
          <textarea
            ref={noteRef}
            id="edit-note"
            className="silo-field"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            placeholder="Why you kept it"
          />
        </div>
        <div className="silo-edit-field silo-edit-description">
          <label htmlFor="edit-description">
            Description <span>From the page</span>
          </label>
          <textarea
            id="edit-description"
            className="silo-field"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="What this is, in your words"
          />
        </div>
        {error && <div role="alert">{error}</div>}
      </div>
      <div className="silo-modal-footer">
        <button
          type="button"
          className="silo-edit-footer-btn silo-quiet-danger"
          disabled={busy}
          onClick={() => {
            trash.mutate(undefined, {
              onSuccess: () => {
                closeEdit();
              },
              onError: () => setError("Couldn't move this link to trash. Try again."),
            });
          }}
        >
          <ReaderIcon name="trash" />
          Move to trash
        </button>
        <span className="silo-footer-spacer" />
        <button type="button" className="silo-edit-footer-btn" disabled={busy} onClick={closeEdit}>
          Cancel
        </button>
        <button type="button" className="silo-edit-save-btn" disabled={busy} onClick={save}>
          Save <kbd className="silo-save-hint">⌘↵</kbd>
        </button>
      </div>
    </ModalShell>
  );
}
