import { useEffect } from 'react';
import { useSettings, useTrashLink } from '../api/hooks';
import type { LinkJson, SettingsMap } from '../api/types';
import { isHoverCapable } from '../lib/pointer';
import { useHoverPreview } from './HoverPreviewContext';
import { ListRow } from './ListRow';
import { RowMenu } from './RowMenu';
import { useRowMenu } from './RowMenuContext';
import { RowPopover } from './RowPopover';
import { useReaderSelection } from './reader/ReaderSelection';
import { useLibrarySelection } from './SelectionContext';

function isInlineSurfaceOn(source: SettingsMap['plugins']['hacker_news'] | undefined) {
  return (source?.enabled ?? true) && (source?.inline ?? true);
}

export function LinkRow({ link }: { link: LinkJson }) {
  const { openMenuId, toggleMenu, closeMenu } = useRowMenu();
  const menuOpen = openMenuId === link.id;
  const selection = useLibrarySelection();
  const reader = useReaderSelection();
  const { scheduleShow, scheduleHide, dismiss } = useHoverPreview();
  const { data: settings } = useSettings();
  useEffect(() => {
    if (menuOpen) scheduleHide(link.id);
  }, [menuOpen, scheduleHide, link.id]);
  useEffect(() => () => dismiss(link.id), [dismiss, link.id]);
  const source = link.sourceData;
  const trash = useTrashLink(link.id);
  return (
    <ListRow
      link={link}
      selection={selection}
      busy={trash.isPending}
      error={trash.isError ? "Couldn't move this link to trash. Try again." : undefined}
      onRemove={() => trash.mutate()}
      menuOpen={menuOpen}
      toggleMenu={() => toggleMenu(link.id)}
      menu={(anchor) =>
        menuOpen && (
          <RowPopover anchor={anchor} onDismiss={closeMenu}>
            <RowMenu link={link} />
          </RowPopover>
        )
      }
      onEnter={(event) => {
        if (!menuOpen && reader?.selectedId !== link.id && isHoverCapable())
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
