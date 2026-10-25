import { useRestoreLink } from '../api/hooks';
import type { TrashLinkJson } from '../api/types';
import { purgeCountdownDays } from '../lib/buckets';
import { ListRow } from './ListRow';
import { MenuAction, MenuSurface } from './MenuSurface';
import { useRowMenu } from './RowMenuContext';
import { RowPopover } from './RowPopover';
import { ReaderIcon } from './reader/ReaderIcon';
import { useTrashSelection } from './SelectionContext';

function TrashRowMenu({ link, onDelete }: { link: TrashLinkJson; onDelete: () => void }) {
  const restore = useRestoreLink(link.id);
  const selection = useTrashSelection();
  const { closeMenu } = useRowMenu();
  const busy = restore.isPending;
  return (
    <MenuSurface className="silo-row-menu" link={link} onClose={closeMenu}>
      <MenuAction
        icon="✓"
        onClick={() => {
          selection.toggle(link.id);
          closeMenu();
        }}
      >
        {selection.isSelected(link.id) ? 'Deselect item' : 'Select item'}
      </MenuAction>
      <MenuAction icon={<ReaderIcon name="external" />} href={link.url} onClick={closeMenu}>
        Open original
      </MenuAction>
      <MenuAction
        icon={<ReaderIcon name="copy" />}
        onClick={() => {
          navigator.clipboard?.writeText(link.url).catch(() => {});
          closeMenu();
        }}
      >
        Copy link
      </MenuAction>
      <MenuAction
        icon={<ReaderIcon name="restore" />}
        disabled={busy}
        onClick={() => {
          selection.deselect([link.id]);
          restore.mutate(undefined, { onSuccess: closeMenu });
        }}
      >
        Restore
      </MenuAction>
      <div className="silo-menu-separator" />
      <MenuAction icon={<ReaderIcon name="trash" />} danger disabled={busy} onClick={onDelete}>
        Delete now
      </MenuAction>
    </MenuSurface>
  );
}

export function TrashRow({
  link,
  purgeWindowDays,
  onDelete,
}: {
  link: TrashLinkJson;
  purgeWindowDays: number;
  onDelete: (id: string) => void;
}) {
  const selection = useTrashSelection();
  const { openMenuId, toggleMenu, closeMenu } = useRowMenu();
  const menuOpen = openMenuId === link.id;
  return (
    <ListRow
      link={link}
      selection={selection}
      purge={purgeCountdownDays(link.deletedAt, purgeWindowDays)}
      menuOpen={menuOpen}
      toggleMenu={() => toggleMenu(link.id)}
      menu={(anchor) =>
        menuOpen && (
          <RowPopover anchor={anchor} onDismiss={closeMenu}>
            <TrashRowMenu
              link={link}
              onDelete={() => {
                closeMenu();
                onDelete(link.id);
              }}
            />
          </RowPopover>
        )
      }
    />
  );
}
