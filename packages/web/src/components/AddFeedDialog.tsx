import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useSubscribeFeed } from '../api/hooks';
import { normalizeFeedUrl } from '../lib/url';
import { Checkbox } from './Checkbox';
import { ModalHeader, ModalShell } from './ModalShell';

export function AddFeedDialog({
  onClose,
  onSubscribed,
}: {
  onClose: () => void;
  onSubscribed: () => void;
}) {
  const [url, setUrl] = useState('');
  const [syncRecents, setSyncRecents] = useState(true);
  const [closing, setClosing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const subscribe = useSubscribeFeed();
  const navigate = useNavigate();
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, 120);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  const close = () => setClosing(true);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (subscribe.isPending) return;
    subscribe.mutate(
      { url: normalizeFeedUrl(url), syncRecents },
      {
        onError: () => input.current?.focus(),
        onSuccess: ({ feed }) => {
          onClose();
          onSubscribed();
          navigate(`/feeds/${feed.id}`);
        },
      },
    );
  }
  return createPortal(
    <ModalShell
      anchored
      width={460}
      ariaLabel="Add feed"
      describedBy="feed-description"
      onClose={close}
      closing={closing}
    >
      <ModalHeader title="Add feed" onClose={close} />
      <p id="feed-description" className="silo-feed-description">
        Automatically save links from your favorite websites and publishers.
      </p>
      <form onSubmit={submit} className="silo-feed-form">
        <label htmlFor="feed-url">Website or feed URL</label>
        <input
          ref={input}
          id="feed-url"
          className="silo-field"
          readOnly={subscribe.isPending}
          aria-busy={subscribe.isPending}
          type="text"
          inputMode="url"
          autoComplete="url"
          required
          maxLength={8192}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            subscribe.reset();
          }}
          placeholder="https://theverge.com or feed URL"
          aria-invalid={subscribe.isError}
          aria-describedby={subscribe.isError ? 'feed-error' : undefined}
        />
        {subscribe.isError && (
          <p id="feed-error" role="alert" className="silo-feed-error">
            {subscribe.error.message}
          </p>
        )}
        <div className="silo-modal-footer silo-feed-footer">
          <Checkbox
            label="Sync recents"
            disabled={subscribe.isPending}
            checked={syncRecents}
            onChange={(event) => setSyncRecents(event.target.checked)}
          />
          <button
            className="silo-edit-save-btn silo-feed-subscribe"
            type="submit"
            aria-disabled={subscribe.isPending}
          >
            {subscribe.isPending ? 'Subscribing…' : 'Subscribe'}
          </button>
        </div>
      </form>
    </ModalShell>,
    document.body,
  );
}
