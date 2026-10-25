import type { LinkJson } from '../api/types';
import { ConfirmDialog } from './ConfirmDialog';
import { LinkIdentity } from './MenuSurface';

export function DeleteForeverDialog({
  count = 1,
  link,
  pending,
  onConfirm,
  onClose,
}: {
  count?: number;
  link?: LinkJson | undefined;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      title={count === 1 ? 'Delete forever?' : `Delete ${count} links forever?`}
      item={
        link ? <LinkIdentity link={link} /> : `${count} selected ${count === 1 ? 'link' : 'links'}`
      }
      action="Delete forever"
      actionLabel="Confirm permanent deletion"
      pending={pending}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      {count === 1 ? 'This link and its note' : 'These links and their notes'} will be deleted
      forever. This cannot be undone.
    </ConfirmDialog>
  );
}
