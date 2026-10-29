import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useRefreshFeed, useUnsubscribeFeed } from '../api/hooks';
import type { FeedJson } from '../api/types';
import { ConfirmDialog } from './ConfirmDialog';
import { MenuPresence } from './MenuPresence';
import { MenuAction, MenuSurface } from './MenuSurface';
import { ReaderIcon } from './reader/ReaderIcon';
import { copyLabel, useCopyFlash } from './SettingsTabs/copyFlash';

export function FeedMenu({ feed }: { feed: FeedJson }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const refresh = useRefreshFeed();
  const unsubscribe = useUnsubscribeFeed();
  const { copied, copyText } = useCopyFlash();
  const navigate = useNavigate();
  return (
    <>
      {refresh.isError && (
        <span role="alert" className="silo-feed-error">
          {refresh.error.message}
        </span>
      )}
      {refresh.isPending && (
        <span role="status" className="silo-feed-description">
          Refreshing…
        </span>
      )}
      <div className="silo-reader-more">
        <button
          type="button"
          className="silo-reader-iconbtn"
          aria-label="Feed actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ReaderIcon name="more" />
        </button>
        <MenuPresence>
          {open && (
            <MenuSurface
              label="Feed actions"
              className="silo-reader-more-menu silo-feed-menu"
              onClose={() => setOpen(false)}
            >
              <MenuAction
                icon={<ReaderIcon name="refresh" />}
                disabled={refresh.isPending}
                onClick={() => {
                  setOpen(false);
                  refresh.mutate(feed.id);
                }}
              >
                {refresh.isPending ? 'Refreshing…' : 'Refresh now'}
              </MenuAction>
              <MenuAction
                icon={<ReaderIcon name="clipboard" />}
                onClick={() => copyText(feed.feedUrl)}
              >
                {copyLabel(copied, 'Copy feed URL')}
              </MenuAction>
              <div className="silo-menu-separator" />
              <MenuAction
                icon={<ReaderIcon name="trash" />}
                danger
                onClick={() => {
                  setOpen(false);
                  unsubscribe.reset();
                  setConfirm(true);
                }}
              >
                Unsubscribe
              </MenuAction>
            </MenuSurface>
          )}
        </MenuPresence>
      </div>
      {confirm && (
        <ConfirmDialog
          title="Unsubscribe from feed?"
          item={feed.title}
          action="Unsubscribe"
          pending={unsubscribe.isPending}
          onClose={() => setConfirm(false)}
          onConfirm={() => unsubscribe.mutate(feed.id, { onSuccess: () => navigate('/') })}
        >
          This removes the feed and its posts. Links saved to Home stay in your library.
          {unsubscribe.isError && (
            <span role="alert" className="silo-feed-error">
              {unsubscribe.error.message}
            </span>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
