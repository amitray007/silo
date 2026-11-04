import type { UIMessage } from '@ai-sdk/react';
import type { ReaderIconName } from '../ReaderIcon';
import { partCitations } from './citationItems';
import { isRunning, type Part, SEARCH_TOOLS, toolCount, toolName, WRITE_TRACES } from './tools';

export type StepRow = {
  key: string;
  icon: ReaderIconName;
  /** Past tense: "Searched your library", "Read “Title”". */
  label: string;
  /** Links found, when every search in the row reported a count. */
  count: number | null;
  /** The distinct links the row's searches returned, in order. */
  hits: { id: string; title: string | null }[];
};

const WRITE_ICONS: Record<string, ReaderIconName> = {
  'Saved to your library': 'bookmark',
  Edited: 'edit',
  Tagged: 'hash',
  Highlighted: 'highlighter',
  'Moved to trash': 'trash',
  Deleted: 'trash',
  Restored: 'restore',
  Subscribed: 'rss',
  Unsubscribed: 'rss',
  Archived: 'archive',
  Refreshed: 'refresh',
  Retried: 'refresh',
};

const DONE = new Set(['output-available', 'output-error']);
const isDone = (part: Part) => toolName(part) !== null && 'state' in part && DONE.has(part.state);

/** What a running tool is doing, for the shimmering line. */
export function runningLabel(part: Part): string {
  const name = toolName(part) ?? '';
  if (name === 'get_link') return 'Reading the article';
  if (name === 'list_highlights') return 'Reading your notes';
  if (SEARCH_TOOLS.has(name)) return 'Searching your library';
  return 'Working';
}

const isFailed = (part: Part) => 'state' in part && part.state === 'output-error';

function searchRow(parts: Part[]): StepRow {
  const counts = parts.map(toolCount).filter((count): count is number => count !== null);
  const hits = new Map<string, string | null>();
  for (const { id, title } of parts.flatMap(partCitations)) hits.set(id, title);
  return {
    key: 'search',
    icon: 'search',
    label: 'Searched your library',
    count: counts.length > 0 ? counts.reduce((sum, count) => sum + count, 0) : null,
    hits: [...hits].map(([id, title]) => ({ id, title })),
  };
}

function readRow(part: Part): StepRow {
  const title = partCitations(part)[0]?.title;
  return {
    key: `read-${'toolCallId' in part ? part.toolCallId : ''}`,
    icon: 'page',
    label: title ? `Read “${title}”` : 'Read the article',
    count: null,
    hits: [],
  };
}

const plainRow = (key: string, icon: ReaderIconName, label: string): StepRow => ({
  key,
  icon,
  label,
  count: null,
  hits: [],
});

const FAILED_LABELS: Record<string, string> = {
  get_link: 'Couldn’t read the article',
  list_highlights: 'Couldn’t read your notes',
};
const failedRow = (name: string) =>
  plainRow(
    `failed-${SEARCH_TOOLS.has(name) ? 'search' : name}`,
    'warning',
    SEARCH_TOOLS.has(name) ? 'Search failed' : (FAILED_LABELS[name] ?? 'A step failed'),
  );

const writeRow = (name: string) => {
  const trace = WRITE_TRACES[name] ?? 'Worked';
  return plainRow(`write-${trace}`, WRITE_ICONS[trace] ?? 'check', trace);
};

/**
 * One row per kind of step, in the order the steps first ran: every search folds into one row,
 * writes that share a phrase share a row, and each article read keeps its own.
 */
export function stepRows(message: UIMessage): StepRow[] {
  const finished = message.parts.filter(isDone);
  const rows: StepRow[] = [];
  const add = (row: StepRow) => {
    if (!rows.some((seen) => seen.key === row.key)) rows.push(row);
  };
  for (const part of finished) {
    const name = toolName(part) ?? '';
    if (isFailed(part)) add(failedRow(name));
    else if (SEARCH_TOOLS.has(name))
      add(searchRow(finished.filter((p) => SEARCH_TOOLS.has(toolName(p) ?? '') && !isFailed(p))));
    else if (name === 'get_link') add(readRow(part));
    else if (name === 'list_highlights') add(plainRow('notes', 'note', 'Read your notes'));
    else add(writeRow(name));
  }
  return rows;
}

/** The tool call that is running now, if any: its label replaces the summary. */
export const runningStep = (message: UIMessage) => message.parts.findLast(isRunning);

export function toolsUsed(message: UIMessage): number {
  return message.parts.filter(isDone).length;
}
