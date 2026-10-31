import type { ProtoIconName } from './ProtoIcon';
import type { HighlightColor } from './useHighlights';

/** What an action can read and do. Built fresh for each selection. */
export type SelectionContext = {
  text: string;
  paragraph: number;
  title: string;
  url: string;
  color: HighlightColor;
  highlight: (color: HighlightColor) => void;
  note: () => void;
  listen: () => void;
  copy: (text: string, done: string) => void;
  /** Open silo's search with a phrase. */
  search: (phrase: string) => void;
};

export type SelectionAction = {
  id: string;
  icon: ProtoIconName;
  label: string;
  /** One short line shown under the label in the More menu. */
  hint: string;
  /** `primary` actions sit in the pill; `more` actions live in the "..." menu. */
  group: 'primary' | 'more';
  /** The Highlight action reveals the colour choices. */
  colors?: boolean;
  run: (context: SelectionContext) => void;
};

/**
 * The selection toolbar is built from this list. A future action (for example Explain,
 * Simplify or Ask) is one more entry here, with no layout change.
 */
export const selectionActions: SelectionAction[] = [
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
    icon: 'notes',
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
        `“${context.text}” — ${context.title}${context.paragraph ? `, ¶${context.paragraph}` : ''}`,
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
    run: (context) => context.search(context.text.slice(0, 120)),
  },
];
