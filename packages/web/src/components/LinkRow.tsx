import { useEffect } from 'react';
import { useSaveFeedPost, useSettings, useTrashLink, useTriageFeedPost } from '../api/hooks';
import type { LinkJson, SettingsMap } from '../api/types';
import { isFeedPost } from '../lib/isFeedPost';
import { isHoverCapable } from '../lib/pointer';
import { useHoverPreview } from './HoverPreviewContext';
import { ListRow } from './ListRow';
import { RowMenu } from './RowMenu';
import { useRowMenu } from './RowMenuContext';
import { RowPopover } from './RowPopover';
import { useReaderSelection } from './reader/ReaderSelection';

function isInlineSurfaceOn(source: SettingsMap['plugins']['hacker_news'] | undefined) {
  return (source?.enabled ?? true) && (source?.inline ?? true);
}

export function LinkRow({ link }: { link: LinkJson }) {
  const { openMenuId, toggleMenu, closeMenu } = useRowMenu();
  const menuOpen = openMenuId === link.id;
  const reader = useReaderSelection();
  const { scheduleShow, scheduleHide, dismiss } = useHoverPreview();
  const { data: settings } = useSettings();
  const hoverEnabled = settings?.hoverPreview === true;
  useEffect(() => {
    if (hoverEnabled) return () => dismiss(link.id);
  }, [hoverEnabled, dismiss, link.id]);
  useEffect(() => {
    if (menuOpen) scheduleHide(link.id);
  }, [menuOpen, scheduleHide, link.id]);
  const source = link.sourceData;
  const trash = useTrashLink();
  const triage = useTriageFeedPost();
  const save = useSaveFeedPost();
  const feedPost = isFeedPost(link);
  return (
    <ListRow
      link={link}
      busy={trash.isPending || triage.isPending || save.isPending}
      error={
        save.error?.message ??
        triage.error?.message ??
        (trash.isError ? "Couldn't move this link to trash. Try again." : undefined)
      }
      onSave={() => {
        if (link.feedId) save.mutate({ feedId: link.feedId, postId: link.id });
      }}
      onRemove={() => {
        if (feedPost && !link.feedId) return;
        if (feedPost && link.feedId)
          triage.mutate({ feedId: link.feedId, postId: link.id, archived: !link.archivedAt });
        else trash.mutate(link.id);
      }}
      menuOpen={menuOpen}
      toggleMenu={() => {
        if (!isFeedPost(link)) toggleMenu(link.id);
      }}
      menu={(anchor) =>
        menuOpen && (
          <RowPopover anchor={anchor} onDismiss={closeMenu}>
            <RowMenu link={link} />
          </RowPopover>
        )
      }
      onEnter={(event) => {
        if (hoverEnabled && !menuOpen && reader?.selectedId !== link.id && isHoverCapable())
          scheduleShow(link, event.currentTarget.getBoundingClientRect());
      }}
      onLeave={() => scheduleHide(link.id)}
      onMenu={() => scheduleHide(link.id)}
    >
      {source.kind === 'hacker_news' && isInlineSurfaceOn(settings?.plugins?.hacker_news) && (
        <span className="silo-row-rich">
          {source.points} points · {source.comments} comments
        </span>
      )}
      {source.kind === 'twitter' && isInlineSurfaceOn(settings?.plugins?.twitter) && (
        <span className="silo-row-rich">{source.text}</span>
      )}
    </ListRow>
  );
}
