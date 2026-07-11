import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModalShell } from './ModalShell';

/** The scrim is the `role="dialog"` panel's parent — walking up one level from the panel gets it without a separate query. */
function scrimOf(panel: HTMLElement): HTMLElement {
  return panel.parentElement as HTMLElement;
}

describe('ModalShell', () => {
  it('defaults to zIndex 40 (byte-for-byte unchanged for existing callers)', () => {
    render(
      <ModalShell width={400} ariaLabel="Test modal" onClose={() => {}}>
        content
      </ModalShell>,
    );

    const panel = screen.getByRole('dialog', { name: 'Test modal' });
    expect(scrimOf(panel).style.zIndex).toBe('40');
  });

  it('respects an explicit zIndex override', () => {
    render(
      <ModalShell width={400} ariaLabel="Stacked modal" onClose={() => {}} zIndex={50}>
        content
      </ModalShell>,
    );

    const panel = screen.getByRole('dialog', { name: 'Stacked modal' });
    expect(scrimOf(panel).style.zIndex).toBe('50');
  });

  /**
   * The stacked-dialog case (`AccessTab`'s "Set up" → `McpSetupDialog` opens
   * ON TOP of `SettingsModal`): both mount their own `ModalShell`, each with
   * its own capture-phase document Escape listener. Capture-phase listeners
   * fire in ADD order regardless of `stopPropagation` (it only stops
   * propagation to OTHER nodes, not sibling listeners on `document`) — so
   * without the open-modal stack, the OUTER (earlier-mounted) modal's
   * listener would fire first and close the wrong one. This proves Escape
   * closes only the topmost (later-mounted) instance.
   */
  it('Escape closes only the topmost of two stacked ModalShell instances', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();

    const { rerender } = render(
      <ModalShell width={400} ariaLabel="Outer" onClose={outerClose}>
        outer
      </ModalShell>,
    );
    rerender(
      <>
        <ModalShell width={400} ariaLabel="Outer" onClose={outerClose}>
          outer
        </ModalShell>
        <ModalShell width={400} ariaLabel="Inner" onClose={innerClose} zIndex={50}>
          inner
        </ModalShell>
      </>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('once the topmost modal unmounts, Escape falls back to the next one down', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();

    const { rerender } = render(
      <>
        <ModalShell width={400} ariaLabel="Outer" onClose={outerClose}>
          outer
        </ModalShell>
        <ModalShell width={400} ariaLabel="Inner" onClose={innerClose} zIndex={50}>
          inner
        </ModalShell>
      </>,
    );

    // Simulate the inner dialog closing (as `McpSetupDialog`'s onClose would
    // do — the parent stops rendering it).
    rerender(
      <ModalShell width={400} ariaLabel="Outer" onClose={outerClose}>
        outer
      </ModalShell>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(outerClose).toHaveBeenCalledTimes(1);
    expect(innerClose).not.toHaveBeenCalled();
  });
});
