import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRefreshReader, useRetryCapture, useTrashLink } from '../api/hooks';
import type { LinkJson } from '../api/types';
import { layoutMedia } from '../lib/breakpoints';
import { MenuPresence } from './MenuPresence';
import { MenuAction, MenuSurface } from './MenuSurface';
import { useRowMenu } from './RowMenuContext';
import { ReaderIcon } from './reader/ReaderIcon';
import { TagPicker, useLinkTags } from './TagOptionsList';

export function RowMenu({ link }: { link: LinkJson }) {
  const { closeMenu } = useRowMenu();
  return (
    <MenuSurface className="silo-row-menu" link={link} onClose={closeMenu}>
      <LinkMenuActions link={link} onClose={closeMenu} />
    </MenuSurface>
  );
}

export function LinkMenuActions({
  link,
  onClose: closeMenu,
  onTrash,
  onCopy,
  busy = false,
  showEdit = true,
  trashed = false,
}: {
  link: LinkJson;
  onClose: () => void;
  onTrash?: () => void;
  onCopy?: () => Promise<void>;
  busy?: boolean;
  showEdit?: boolean;
  trashed?: boolean;
}) {
  const { openEdit } = useRowMenu();
  const [tagsOpen, setTagsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const trash = useTrashLink();
  const retry = useRetryCapture(link.id);
  const refresh = useRefreshReader(link.id);
  const refreshFailed = refresh.isError;
  const resetRefresh = refresh.reset;
  useEffect(() => {
    if (!refreshFailed) return;
    const timer = setTimeout(resetRefresh, 5000);
    return () => clearTimeout(timer);
  }, [refreshFailed, resetRefresh]);
  const tags = useLinkTags(link);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tagsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(copyTimer.current);
      clearTimeout(tagsTimer.current);
    },
    [],
  );
  const keep = () => {
    clearTimeout(tagsTimer.current);
    setTagsOpen(true);
  };
  const hide = () => {
    if (matchMedia(layoutMedia.phone).matches) return;
    clearTimeout(tagsTimer.current);
    tagsTimer.current = setTimeout(() => setTagsOpen(false), 140);
  };
  return (
    <>
      <MenuAction
        href={link.url}
        onClick={closeMenu}
        icon={<ReaderIcon name="external" />}
        shortcut="o"
      >
        Open original
      </MenuAction>
      <MenuAction
        icon={<ReaderIcon name="copy" />}
        shortcut="c"
        onClick={() => {
          (onCopy ? onCopy() : navigator.clipboard.writeText(link.url)).catch(() => {});
          setCopied(true);
          clearTimeout(copyTimer.current);
          copyTimer.current = setTimeout(() => setCopied(false), 700);
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </MenuAction>
      {!trashed &&
        !('deletedAt' in link) &&
        link.sourceKind !== 'twitter' &&
        link.sourceData.kind !== 'twitter' && (
          <MenuAction
            icon={<ReaderIcon name="refresh" />}
            shortcut="r"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? 'Refreshing…' : 'Refresh reader'}
          </MenuAction>
        )}
      {refresh.isError &&
        // The menu surface is transformed, which would trap a fixed toast inside it.
        createPortal(
          <div className="silo-toast" role="alert">
            {refresh.error.message}
          </div>,
          document.body,
        )}
      {showEdit && (
        <MenuAction
          icon={<ReaderIcon name="edit" />}
          shortcut="e"
          onClick={() => {
            closeMenu();
            openEdit(link);
          }}
        >
          Edit
        </MenuAction>
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover supplements the native Tags button. */}
      <div
        className="silo-tags-anchor"
        onMouseEnter={() => {
          if (!matchMedia(layoutMedia.phone).matches) keep();
        }}
        onMouseLeave={() => {
          if (!matchMedia(layoutMedia.phone).matches) hide();
        }}
      >
        <button
          type="button"
          className="silo-menu-item"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={tagsOpen}
          onClick={keep}
        >
          <span className="silo-menu-icon">
            <ReaderIcon name="hash" />
          </span>
          <span>Tags</span>
          {tags.tags.length > 0 && <span className="silo-tag-count">{tags.tags.length}</span>}
          <span className="silo-menu-chevron">
            <ReaderIcon name="right" />
          </span>
        </button>
        <MenuPresence>
          {tagsOpen && (
            <TagPicker
              membership={tags}
              link={link}
              className="silo-tags-flyout"
              onClose={() => setTagsOpen(false)}
              onMouseEnter={keep}
              onMouseLeave={hide}
            />
          )}
        </MenuPresence>
      </div>
      {link.captureStatus !== 'full' && (
        <MenuAction
          icon={<ReaderIcon name="refresh" />}
          onClick={() => {
            closeMenu();
            retry.mutate();
          }}
        >
          {link.captureStatus === 'enriching' ? 'Re-enrich' : 'Enrich'}
        </MenuAction>
      )}
      <div className="silo-menu-separator" />
      <MenuAction
        icon={<ReaderIcon name="trash" />}
        danger
        shortcut="⌫"
        disabled={busy}
        onClick={() => {
          closeMenu();
          if (onTrash) onTrash();
          else trash.mutate(link.id);
        }}
      >
        Move to trash
      </MenuAction>
    </>
  );
}
