import { useEffect } from 'react';
import type { PendingSelection } from './useSelectionWatcher';

/** Put the native selection back on the passage, after the composer's field took focus from it. */
export function restoreSelection(pending: PendingSelection | null) {
  if (!pending) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(pending.range);
}

/**
 * Keep the passage painted while the question field owns focus: the native selection greys out
 * there, so the same range is registered as a custom highlight that `reader-highlights.css` paints.
 */
export function useRetainedSelection(range: Range | undefined, active: boolean) {
  useEffect(() => {
    if (
      !range ||
      !active ||
      typeof CSS === 'undefined' ||
      !('highlights' in CSS) ||
      typeof Highlight === 'undefined'
    )
      return;
    const mark = new Highlight(range);
    mark.priority = 15;
    CSS.highlights.set('silo-librarian-selection', mark);
    return () => {
      CSS.highlights.delete('silo-librarian-selection');
    };
  }, [range, active]);
}
