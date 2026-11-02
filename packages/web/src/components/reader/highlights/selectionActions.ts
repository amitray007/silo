import type { HighlightColor } from '../../../lib/highlights';
import type { ReaderIconName } from '../ReaderIcon';

/** What an action can read and do. Built fresh for each selection. */
export type SelectionContext = {
  text: string;
  /** The 1-based paragraph number the selection starts in; 0 when none holds it. */
  paragraph: number;
  title: string;
  /** The colour a click on Highlight applies. */
  color: HighlightColor;
  highlight: (color: HighlightColor) => void;
  note: () => void;
  /** Read aloud from the sentence the selection starts in. */
  listen: () => void;
  /** Copy text, then say `done` in a short toast. */
  copy: (text: string, done: string) => void;
  /** Open silo's search with a phrase. */
  search: (phrase: string) => void;
};

export type SelectionAction = {
  id: string;
  icon: ReaderIconName;
  label: string;
  /** One short muted line under the label in the More menu. */
  hint: string;
  /** `primary` actions sit in the pill; `more` actions live in the "..." menu. */
  group: 'primary' | 'more';
  /** The Highlight action reveals the colour choices. */
  colors?: boolean;
  run: (context: SelectionContext) => void;
};

/** The longest phrase handed to search. */
const SEARCH_PHRASE_MAX = 120;

/**
 * The selection toolbar is built from this list. A later action (Explain or Ask) is one more
 * entry, with no layout change.
 */
export const selectionActions: readonly SelectionAction[] = [
  {
    id: 'highlight',
    icon: 'highlighter',
    label: 'Highlight',
    hint: 'Mark the passage',
    group: 'primary',
    colors: true,
    run: (context) => context.highlight(context.color),
  },
  {
    id: 'note',
    icon: 'note',
    label: 'Note',
    hint: 'Highlight and write a note',
    group: 'primary',
    run: (context) => context.note(),
  },
  {
    id: 'listen',
    icon: 'headphones',
    label: 'Listen from here',
    hint: 'Read aloud from this sentence',
    group: 'primary',
    run: (context) => context.listen(),
  },
  {
    id: 'copy-quote',
    icon: 'quote',
    label: 'Copy quote',
    hint: 'With title and paragraph number',
    group: 'more',
    run: (context) =>
      context.copy(
        `"${context.text}" - ${context.title}${context.paragraph ? `, ¶${context.paragraph}` : ''}`,
        'Quote copied',
      ),
  },
  {
    id: 'copy-text',
    icon: 'copy',
    label: 'Copy text',
    hint: 'Plain text, nothing added',
    group: 'more',
    run: (context) => context.copy(context.text, 'Text copied'),
  },
  {
    id: 'search-silo',
    icon: 'search',
    label: 'Search silo',
    hint: 'Find this phrase in your library',
    group: 'more',
    run: (context) => context.search(context.text.slice(0, SEARCH_PHRASE_MAX)),
  },
];
