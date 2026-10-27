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

  it('focuses the panel when confirmation becomes pending and traps Tab without enabled controls', () => {
    const props = {
      title: 'Delete forever?',
      action: 'Delete',
      onConfirm: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<ConfirmDialog {...props}>Cannot undo.</ConfirmDialog>);
    screen.getByRole('button', { name: 'Delete' }).focus();
    rerender(
      <ConfirmDialog {...props} pending>
        Cannot undo.
      </ConfirmDialog>,
    );
    const panel = screen.getByRole('alertdialog');
    expect(document.activeElement).toBe(panel);
    expect(fireEvent.keyDown(panel, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(panel);
    expect(fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(panel);
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
