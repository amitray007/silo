import { ConfirmDialog } from './ConfirmDialog';

/** Shared tag-removal confirmation; callers own mutation and navigation behavior. */
export function DeleteTagDialog({
  tag,
  pending,
  error,
  actionLabel,
  onClose,
  onConfirm,
}: {
  tag: string;
  pending: boolean;
  error?: string | undefined;
  actionLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      title="Delete tag?"
      item={`#${tag}`}
      action="Delete tag"
      {...(actionLabel === undefined ? {} : { actionLabel })}
      pending={pending}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      The tag #{tag} will be removed from all links. Your links will be kept.
      {error !== undefined && <span role="alert">{error}</span>}
    </ConfirmDialog>
  );
}
