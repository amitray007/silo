import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('requires the explicit action; cancel and Escape only dismiss', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        title="Empty trash?"
        action="Empty trash"
        onConfirm={onConfirm}
        onClose={onClose}
      >
        Links will be deleted forever.
      </ConfirmDialog>,
    );
    expect(screen.getByRole('alertdialog', { name: 'Empty trash?' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Empty trash' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('blocks repeated confirmation and dismissal while the action is pending', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        title="Revoke access?"
        action="Revoke"
        pending
        onConfirm={onConfirm}
        onClose={onClose}
      >
        The connection will lose access.
      </ConfirmDialog>,
    );
    expect(screen.getByRole('button', { name: 'Working…' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Working…' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
