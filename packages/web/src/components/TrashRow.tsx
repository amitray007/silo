import { useRestoreLink } from '../api/hooks';
import type { TrashLinkJson } from '../api/types';
import { purgeCountdownDays } from '../lib/buckets';
import { ListRow } from './ListRow';
import { useRowMenu } from './RowMenuContext';
import { RowPopover } from './RowPopover';
import { useTrashSelection } from './SelectionContext';

function TrashRowMenu({ link, onDelete }: { link: TrashLinkJson; onDelete: () => void }) {
  const restore = useRestoreLink(link.id);
  const selection = useTrashSelection();
  const { closeMenu } = useRowMenu();
  const busy = restore.isPending;
  return (
    <div
      className="silo-trash-row-menu"
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          selection.toggle(link.id);
          closeMenu();
        }}
      >
        {selection.isSelected(link.id) ? 'Deselect item' : 'Select item'}
      </button>
      <a role="menuitem" href={link.url} target="_blank" rel="noopener noreferrer">
        Open original
      </a>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          navigator.clipboard?.writeText(link.url).catch(() => {});
          closeMenu();
        }}
      >
        Copy link
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={() => {
          selection.deselect([link.id]);
          restore.mutate(undefined, { onSuccess: closeMenu });
        }}
      >
        Restore
      </button>
      <button type="button" role="menuitem" disabled={busy} onClick={onDelete}>
        Delete now
      </button>
    </div>
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
