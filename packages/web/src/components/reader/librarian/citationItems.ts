import type { UIMessage } from '@ai-sdk/react';

export type CitationItem = { id: string; title: string | null };

const DATA_MARKER = 'Data (JSON):';
// Summary lines read "- Title (id: <uuid>) — url"; they survive when the JSON after them is truncated.
const summaryLine = /^- (?:\(rank [\d.]+\) )?(.+?) \(id: ([0-9a-f-]{36})\)/gim;

function readText(output: string): CitationItem[] {
  const marker = output.indexOf(DATA_MARKER);
  try {
    return readItems(
      JSON.parse(output.slice(marker === -1 ? output.search(/[[{]/) : marker + DATA_MARKER.length)),
    );
  } catch {
    return [...output.matchAll(summaryLine)].map(([, title = '', id = '']) => ({ id, title }));
  }
}

function readItems(output: unknown): CitationItem[] {
  if (typeof output === 'string') return readText(output);
  if (Array.isArray(output)) return output.flatMap(readItems);
  if (!output || typeof output !== 'object') return [];
  if (
    'id' in output &&
    typeof output.id === 'string' &&
    'title' in output &&
    typeof output.title === 'string'
  ) {
    return [{ id: output.id, title: output.title }];
  }
  return Object.entries(output)
    .filter(([key]) => ['results', 'links', 'link', 'text', 'content'].includes(key))
    .flatMap(([, value]) => readItems(value));
}

export function citationItems(message: UIMessage): CitationItem[] {
  return message.parts.flatMap((part) => {
    const name = part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5);
    return ['search_links', 'find_related', 'list_links', 'get_link'].includes(name) &&
      'output' in part
      ? readItems(part.output)
      : [];
  });
}

export function matchCitation(title: string, items: CitationItem[]): string | undefined {
  const text = title.trim().toLowerCase();
  const matches = items.filter((item) => {
    const full = (item.title ?? '').trim().toLowerCase();
    return (
      full.length > 0 &&
      (text === full || (text.startsWith(full) && /^\p{P}/u.test(text.slice(full.length))))
    );
  });
  const ids = [...new Set(matches.map((item) => item.id))];
  return ids.length === 1 ? ids[0] : undefined;
}
