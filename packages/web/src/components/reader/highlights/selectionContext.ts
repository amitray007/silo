import type { HighlightColor } from '../../../lib/highlights';
import { paragraphNumber } from './paragraphs';
import type { SelectionContext } from './selectionActions';
import type { PendingSelection } from './useSelectionWatcher';

type Handlers = {
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onDismiss: () => void;
  onSearch: (phrase: string) => void;
  onListen: () => void;
  /** Say what was copied, in a short toast. */
  onCopied: (message: string) => void;
};

function clearSelection() {
  window.getSelection()?.removeAllRanges();
}

/** What an action can read and do for the current selection; every action that ends it dismisses it. */
export function selectionContext({
  pending,
  prose,
  title,
  color,
  handlers,
}: {
  pending: PendingSelection;
  prose: HTMLElement;
  title: string;
  color: HighlightColor;
  handlers: Handlers;
}): SelectionContext {
  const { onHighlight, onNote, onDismiss, onSearch, onListen, onCopied } = handlers;
  const end = () => {
    onDismiss();
    clearSelection();
  };
  return {
    text: pending.range.toString().replace(/\s+/g, ' ').trim(),
    paragraph: paragraphNumber(prose, pending.range.startContainer),
    title,
    color,
    highlight: onHighlight,
    note: onNote,
    copy: (text, done) => {
      void navigator.clipboard?.writeText(text);
      onCopied(done);
      end();
    },
    listen: () => {
      onListen();
      end();
    },
    search: (phrase) => {
      onDismiss();
      onSearch(phrase);
    },
  };
}
