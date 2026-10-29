import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSubscribeFeed } from '../api/hooks';
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
  const input = useRef<HTMLInputElement>(null);
  const subscribe = useSubscribeFeed();
  const navigate = useNavigate();
  useEffect(() => {
    input.current?.focus();
  }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (subscribe.isPending) return;
    subscribe.mutate(
      { url: url.trim(), syncRecents },
      {
        onSuccess: ({ feed }) => {
          onClose();
          onSubscribed();
          navigate(`/feeds/${feed.id}`);
        },
      },
    );
  }
  return (
    <ModalShell width={460} ariaLabel="Add feed" onClose={onClose}>
      <ModalHeader title="Add feed" onClose={onClose} />
      <p className="silo-feed-description">
        Automatically save links from your favorite websites and publishers.
      </p>
      <form onSubmit={submit} className="silo-feed-form">
        <label htmlFor="feed-url">Website or feed URL</label>
        <input
          ref={input}
          id="feed-url"
          className="silo-field"
          disabled={subscribe.isPending}
          type="url"
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
        <label className="silo-feed-checkbox">
          <input
            disabled={subscribe.isPending}
            type="checkbox"
            checked={syncRecents}
            onChange={(event) => setSyncRecents(event.target.checked)}
          />
          Sync recents
        </label>
        <div className="silo-modal-footer">
          <button className="silo-edit-save-btn" type="submit" disabled={subscribe.isPending}>
            {subscribe.isPending ? 'Subscribing…' : 'Subscribe'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
