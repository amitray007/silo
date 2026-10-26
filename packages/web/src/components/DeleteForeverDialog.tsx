import type { LinkJson } from '../api/types';
import { ConfirmDialog } from './ConfirmDialog';
import { LinkIdentity } from './MenuSurface';

export function DeleteForeverDialog({
  link,
  pending,
  onConfirm,
  onClose,
}: {
  link?: LinkJson | undefined;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      title="Delete forever?"
      item={link ? <LinkIdentity link={link} /> : 'This link'}
      action="Delete forever"
      actionLabel="Confirm permanent deletion"
      pending={pending}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      This link and its note will be deleted forever. This cannot be undone.
    </ConfirmDialog>
  );
}
