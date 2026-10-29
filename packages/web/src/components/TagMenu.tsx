import { type ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMatch, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useDeleteTag, useRenameTag } from '../api/hooks';
import { ConfirmDialog } from './ConfirmDialog';
import { MenuPresence } from './MenuPresence';
import { MenuAction, MenuSurface } from './MenuSurface';
import { RenameDialog } from './RenameDialog';
import { RowPopover } from './RowPopover';
import { ReaderIcon } from './reader/ReaderIcon';
import { SidebarContextMenu } from './SidebarContextMenu';

export function TagMenu({ tag, children }: { tag: string; children: ReactNode }) {
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
      <SidebarContextMenu
        onOpen={(row) => {
          setAnchor(row);
          setOpen(true);
        }}
      >
        {children}
      </SidebarContextMenu>
      <RowPopover anchor={anchor} onDismiss={close}>
        <MenuPresence>
          {open && (
            <MenuSurface label="Tag actions" onClose={close}>
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
      {renaming && (
        <RenameDialog
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
          <ConfirmDialog
            title="Delete tag?"
            item={`#${tag}`}
            action="Delete tag"
            pending={remove.isPending}
            onClose={() => setConfirmDelete(false)}
            onConfirm={() =>
              remove.mutate(tag, {
                onSuccess: () => {
                  setConfirmDelete(false);
                  if (current === tag) navigate('/');
                },
              })
            }
          >
            The tag #{tag} will be removed from all links. Your links will be kept.
            {remove.isError && <span role="alert">{remove.error.message}</span>}
          </ConfirmDialog>,
          document.body,
        )}
    </>
  );
}
