import { useEffect } from 'react';
import { isProseRange } from './textMap';
import type { PendingSelection } from './useSelectionWatcher';

/** Put the native selection back on the passage, after the composer's field took focus from it. */
export function restoreSelection(pending: PendingSelection | null) {
  if (!pending) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(pending.range);
}

/** The Custom Highlight API can paint a range without wrapping it in DOM. */
export function canRetainSelection(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

/**
 * Keep the passage painted while the question field owns focus: the native selection greys out
 * there, so the same range is registered as a custom highlight that `reader-recede.css` paints.
 */
export function useRetainedSelection(
  prose: HTMLElement | null,
  range: Range | undefined,
  active: boolean,
) {
  useEffect(() => {
    if (!isProseRange(prose, range) || !active || !canRetainSelection()) return;
    const mark = new Highlight(range);
    mark.priority = 15;
    const update = () => {
      const selection = window.getSelection();
      const current = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
      const field = document.activeElement;
      const fieldSelection =
        (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) &&
        field.selectionStart !== field.selectionEnd;
      if (fieldSelection || (selection && !selection.isCollapsed && !isProseRange(prose, current)))
        CSS.highlights.delete('silo-librarian-selection');
      else CSS.highlights.set('silo-librarian-selection', mark);
    };
    update();
    document.addEventListener('selectionchange', update, { passive: true });
    document.addEventListener('select', update, { capture: true, passive: true });
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('select', update, true);
      CSS.highlights.delete('silo-librarian-selection');
    };
  }, [prose, range, active]);
}
