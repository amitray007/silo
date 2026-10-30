import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMatch, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { queryKeys, useDeleteTag, useRenameTag } from '../api/hooks';
import { ConfirmDialog } from './ConfirmDialog';
import { DeleteTagDialog } from './DeleteTagDialog';
import { MenuPresence } from './MenuPresence';
import { MenuAction, MenuSurface } from './MenuSurface';
import { RenameDialog } from './RenameDialog';
import { RowPopover } from './RowPopover';
import { ReaderIcon } from './reader/ReaderIcon';
import { SidebarContextMenu } from './SidebarContextMenu';

export function TagMenu({ tag, children }: { tag: string; children?: ReactNode }) {
  const queryClient = useQueryClient();
  const trigger = useRef<HTMLButtonElement>(null);
  const renamedTag = useRef(tag);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mergeName, setMergeName] = useState<string | null>(null);
  const rename = useRenameTag();
  const remove = useDeleteTag();
  const navigate = useNavigate();
  const current = useMatch('/tags/:name')?.params.name;
  const close = () => setOpen(false);
  function save(newName: string, merge = false) {
    rename.mutate(
      { name: tag, newName, merge },
      {
        onSuccess: (result) => {
          renamedTag.current = result.name;
          setRenaming(false);
          setMergeName(null);
          if (current?.toLowerCase() === tag.toLowerCase())
            navigate(`/tags/${encodeURIComponent(result.name)}`);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.error === 'tag_exists') setMergeName(newName);
        },
      },
    );
  }
  return (
    <>
      <div className={children ? undefined : 'silo-reader-more'}>
        {children ? (
          <SidebarContextMenu
            onOpen={(row) => {
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
            aria-label="Tag actions"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ReaderIcon name="more" />
          </button>
        )}
        <RowPopover anchor={anchor} onDismiss={close}>
          <MenuPresence>
            {open && (
              <MenuSurface
                label="Tag actions"
                className={children ? '' : 'silo-reader-more-menu'}
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
                <div className="silo-menu-separator" />
                <MenuAction
                  danger
                  icon={<ReaderIcon name="trash" />}
                  onClick={() => {
                    close();
                    remove.reset();
                    setConfirmDelete(true);
                  }}
                >
                  Delete
                </MenuAction>
              </MenuSurface>
            )}
          </MenuPresence>
        </RowPopover>
      </div>
      {renaming && (
        <RenameDialog
          returnFocus={async () => {
            if (!anchor) return trigger.current;
            // A rename replaces the name-keyed sidebar row after its query refresh.
            // Join that refresh before resolving the new row, without cancelling it.
            if (renamedTag.current !== tag) {
              await queryClient.refetchQueries(
                { queryKey: queryKeys.tags() },
                { cancelRefetch: false },
              );
              await new Promise(requestAnimationFrame);
            }
            if (anchor.isConnected) return anchor;
            return (
              Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
                (link) =>
                  link.getAttribute('href') === `/tags/${encodeURIComponent(renamedTag.current)}`,
              ) ?? null
            );
          }}
          title="Rename tag"
          initialValue={tag}
          pending={rename.isPending}
          error={rename.isError && !mergeName ? rename.error.message : undefined}
          onSave={(value) => save(value)}
          onClose={() => setRenaming(false)}
        />
      )}
      {mergeName &&
        createPortal(
          <ConfirmDialog
            title="Merge tags?"
            item={`#${tag} → #${mergeName}`}
            action="Merge tags"
            pending={rename.isPending}
            onClose={() => {
              setMergeName(null);
              rename.reset();
            }}
            onConfirm={() => save(mergeName, true)}
          >
            The tag #{tag} will merge into #{mergeName}. Links keep their tags.
            {rename.isError &&
              rename.error instanceof ApiError &&
              rename.error.error !== 'tag_exists' && (
                <span role="alert">{rename.error.message}</span>
              )}
          </ConfirmDialog>,
          document.body,
        )}
      {confirmDelete &&
        createPortal(
          <DeleteTagDialog
            tag={tag}
            pending={remove.isPending}
            error={remove.isError ? remove.error.message : undefined}
            onClose={() => setConfirmDelete(false)}
            onConfirm={() =>
              remove.mutate(tag, {
                onSuccess: () => {
                  setConfirmDelete(false);
                  if (current === tag) navigate('/');
                },
              })
            }
          />,
          document.body,
        )}
    </>
  );
}
