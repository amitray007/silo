import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useCaptureLink } from '../api/hooks';
import { looksLikeUrl } from '../lib/url';
import { ReaderIcon } from './reader/ReaderIcon';

export function PasteCaptureButton({ tags }: { tags?: string[] }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const capture = useCaptureLink();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const pointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', pointer);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('mousedown', pointer);
      document.removeEventListener('keydown', keyboard, true);
      trigger.current?.focus();
    };
  }, [open]);
  function save(text: string) {
    const value = text.trim();
    if (!looksLikeUrl(value)) {
      setMessage("That doesn't look like a link");
      return;
    }
    setMessage('');
    capture.mutate(tags ? { url: value, tags } : { url: value }, {
      onSuccess: () => {
        setUrl('');
        setMessage('Saved');
      },
      onError: () => setMessage("Couldn't save that link. Try again."),
    });
  }
  async function paste() {
    try {
      if (!navigator.clipboard?.readText) {
        setMessage('Clipboard access blocked');
        return;
      }
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setMessage('Clipboard is empty');
        return;
      }
      save(text);
    } catch {
      setMessage('Clipboard access blocked');
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    save(url);
  }
  return (
    <div className="silo-capture" ref={root}>
      <button
        type="button"
        ref={trigger}
        className="silo-reader-iconbtn silo-add-trigger"
        aria-label="Add link"
        title="Add link"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setMessage('');
        }}
      >
        <ReaderIcon name="plus" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Paste to save"
          className="silo-popover silo-menu-surface silo-capture-popover"
          data-reader-menu
        >
          <div className="silo-capture-title">Paste to save</div>
          <p>Press ⌘V anywhere on this page to save a link.</p>
          <form onSubmit={submit}>
            <input
              ref={input}
              className="silo-field"
              aria-label="Link URL"
              placeholder="https://"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <button type="submit" className="silo-primary-button" disabled={capture.isPending}>
              Save link
            </button>
          </form>
          <button
            type="button"
            className="silo-settings-btn"
            onClick={paste}
            disabled={capture.isPending}
          >
            Paste from clipboard
          </button>
          {message && <p role={message === 'Saved' ? 'status' : 'alert'}>{message}</p>}
        </div>
      )}
    </div>
  );
}
