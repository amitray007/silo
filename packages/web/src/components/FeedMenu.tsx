import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useRefreshFeed, useRenameFeed, useUnsubscribeFeed } from '../api/hooks';
import type { FeedJson } from '../api/types';
import { ConfirmDialog } from './ConfirmDialog';
import { MenuPresence } from './MenuPresence';
import { MenuAction, MenuSurface } from './MenuSurface';
import { RenameDialog } from './RenameDialog';
import { RowPopover } from './RowPopover';
import { ReaderIcon } from './reader/ReaderIcon';
import { copyLabel, useCopyFlash } from './SettingsTabs/copyFlash';
import { SidebarContextMenu } from './SidebarContextMenu';

export function FeedMenu({ feed, children }: { feed: FeedJson; children?: ReactNode }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const refresh = useRefreshFeed();
  const refreshFailed = refresh.isError;
  const resetRefresh = refresh.reset;
  useEffect(() => {
    if (!refreshFailed) return;
    const timer = setTimeout(resetRefresh, 5000);
    return () => clearTimeout(timer);
  }, [refreshFailed, resetRefresh]);
  const rename = useRenameFeed(feed.id);
  const unsubscribe = useUnsubscribeFeed();
  const { copied, copyText } = useCopyFlash();
  const navigate = useNavigate();
  const close = () => setOpen(false);
  return (
    <>
      {(refresh.isError || refresh.isRefreshing) &&
        createPortal(
          <div
            role={refresh.isError ? 'alert' : 'status'}
            className="silo-toast"
            style={{ color: 'var(--ink)' }}
          >
            {refresh.isError ? refresh.error.message : 'Refreshing…'}
          </div>,
          document.body,
        )}
      <div className={children ? undefined : 'silo-reader-more'}>
        {children ? (
          <SidebarContextMenu
            onOpen={(row) => {
              if (refreshFailed) resetRefresh();
              setAnchor(row);
              setOpen(true);
            }}
          >
            {children}
          </SidebarContextMenu>
        ) : (
          <button
            ref={trigger}
            type="button"
            className="silo-reader-iconbtn"
            aria-label="Feed actions"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              if (refreshFailed) resetRefresh();
              setOpen(!open);
            }}
          >
            <ReaderIcon name="more" />
          </button>
        )}
        <RowPopover anchor={anchor} onDismiss={close}>
          <MenuPresence>
            {open && (
              <MenuSurface
                label="Feed actions"
                className={children ? 'silo-feed-menu' : 'silo-reader-more-menu silo-feed-menu'}
                onClose={close}
              >
                <MenuAction
                  icon={<ReaderIcon name="edit" />}
                  onClick={() => {
                    close();
                    rename.reset();
                    setRenaming(true);
                  }}
                >
                  Rename
                </MenuAction>
                <MenuAction
                  icon={<ReaderIcon name="sync" />}
                  disabled={refresh.isRefreshing}
                  onClick={() => {
                    close();
                    refresh.mutate(feed.id);
                  }}
                >
                  {refresh.isRefreshing ? 'Refreshing…' : 'Refresh now'}
                </MenuAction>
                <MenuAction
                  icon={<ReaderIcon name="copy" />}
                  onClick={() => copyText(feed.feedUrl)}
                >
                  {copyLabel(copied, 'Copy feed URL')}
                </MenuAction>
                {feed.siteUrl && (
                  <MenuAction
                    icon={<ReaderIcon name="arrowUpRight" />}
                    href={feed.siteUrl}
                    onClick={close}
                  >
                    Open site
                  </MenuAction>
                )}
                {feed.status !== 'active' && feed.lastError && (
                  <div
                    role="note"
                    tabIndex={-1}
                    data-menu-readonly
                    className="silo-feed-menu-error"
                  >
                    {feed.lastError}
                  </div>
                )}
                <div className="silo-menu-separator" />
                <MenuAction
                  icon={<ReaderIcon name="trash" />}
                  danger
                  onClick={() => {
                    close();
                    unsubscribe.reset();
                    setConfirm(true);
                  }}
                >
                  Unsubscribe
                </MenuAction>
              </MenuSurface>
            )}
          </MenuPresence>
        </RowPopover>
      </div>
      {renaming && (
        <RenameDialog
          returnFocus={() => anchor ?? trigger.current}
          title="Rename feed"
          initialValue={feed.title}
          hint="Clear the name to use the publisher’s title."
          pending={rename.isPending}
          error={rename.isError ? rename.error.message : undefined}
          onClose={() => setRenaming(false)}
          onSave={(value) => rename.mutate(value || null, { onSuccess: () => setRenaming(false) })}
        />
      )}
      {confirm &&
        createPortal(
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
          </ConfirmDialog>,
          document.body,
        )}
    </>
  );
}
