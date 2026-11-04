import type { LibrarianAnswerMetadata } from '../../../api/librarian';

export type AnswerVersions = NonNullable<LibrarianAnswerMetadata['versions']>;

export type PagerEntry = { id: string; model: string | undefined };

/**
 * Pager order, oldest first. The server stores the other answers in `versions` and swaps the
 * chosen one with the live answer, so ids stay with their answer but slots move. `previous`
 * is the order already shown: it keeps positions steady while paging, and ids it has not seen
 * (a fresh regeneration) go at the end. After a reload the order restarts as saved versions
 * then the live answer.
 */
export function pagerOrder(
  previous: readonly string[],
  live: PagerEntry,
  versions: AnswerVersions,
): PagerEntry[] {
  const entries = new Map<string, PagerEntry>(
    versions.map((v) => [v.id, { id: v.id, model: v.metadata.model?.label }]),
  );
  entries.set(live.id, live);
  const seen = previous.filter((id) => entries.has(id));
  const fresh = [...entries.keys()].filter((id) => !seen.includes(id));
  return [...seen, ...fresh].flatMap((id) => entries.get(id) ?? []);
}
