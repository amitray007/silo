import { ConfirmDialog } from './ConfirmDialog';

export function DeleteForeverDialog({
  count = 1,
  pending,
  onConfirm,
  onClose,
}: {
  count?: number;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      title={count === 1 ? 'Delete forever?' : `Delete ${count} links forever?`}
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
