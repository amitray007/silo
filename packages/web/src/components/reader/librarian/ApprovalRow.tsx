import { useQueries } from '@tanstack/react-query';
import { apiGet } from '../../../api/client';
import { useFeed } from '../../../api/feedHooks';
import { queryKeys, useLink } from '../../../api/hooks';
import type { LinkResponse } from '../../../api/types';

export function ApprovalRow({
  name,
  input,
  expired,
  linkId,
  onDecision,
}: {
  name: string;
  input: unknown;
  expired: boolean;
  linkId?: string | undefined;
  onDecision?: ((approved: boolean) => void) | undefined;
}) {
  const args = (input ?? {}) as Record<string, unknown>;
  const article = useLink(linkId, { enabled: Boolean(linkId) });
  const highlight = article.data?.link.highlights?.find((item) => item.id === args.id);
  const ids = name.endsWith('_link')
    ? (Array.isArray(args.ids) ? args.ids : [args.id]).filter(
        (id): id is string => typeof id === 'string',
      )
    : [];
  const targets = useQueries({
    queries: ids.slice(0, 3).map((id) => ({
      queryKey: queryKeys.link(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiGet<LinkResponse>(`/api/links/${encodeURIComponent(id)}?view=reader`, signal),
    })),
  });
  const feed = useFeed(name === 'unsubscribe_feed' ? String(args.feedId ?? '') : '');
  const titles = targets
    .map((target) => `“${target.data?.link.title || target.data?.link.url || 'a link'}”`)
    .join(', ');
  const target = `${titles}${ids.length > 3 ? ` +${ids.length - 3} more` : ''}` || 'a link';
  const sentence = approvalSentence(
    name,
    args,
    target,
    article.data?.link.title,
    highlight?.quote,
    feed.data?.feed.title,
  );
  return (
    <fieldset className="silo-chat-approval" aria-label={sentence}>
      <p>{sentence}</p>
      {(name === 'edit_link' || name === 'edit_highlight') && (
        <p>{String(args.note ?? '').slice(0, 80)}</p>
      )}
      {expired ? (
        <p>Expired. Ask again.</p>
      ) : (
        <>
          <button
            type="button"
            className="silo-chat-allow"
            disabled={!onDecision}
            onClick={() => onDecision?.(true)}
          >
            Allow
          </button>
          <button type="button" disabled={!onDecision} onClick={() => onDecision?.(false)}>
            Deny
          </button>
        </>
      )}
    </fieldset>
  );
}

function approvalSentence(
  name: string,
  args: Record<string, unknown>,
  target: string,
  title?: string | null,
  quote?: string,
  feed?: string,
): string {
  switch (name) {
    case 'trash_link':
      return `Move ${target} to trash?`;
    case 'hard_delete_link':
      return `Permanently delete ${target}?`;
    case 'delete_tag':
      return `Delete the tag “${String(args.name ?? '')}”?`;
    case 'delete_highlight':
      return `Delete ${quote ? `“${quote}”` : 'a highlight'}?`;
    case 'rename_tag':
      return `Merge “${String(args.name)}” into “${String(args.newName)}”? Links keep one tag.`;
    case 'edit_link':
      return `Replace the note on ${target}?`;
    case 'edit_highlight':
      return `Replace the note on “${title || 'this article'}”?`;
    default:
      return `Unsubscribe from “${feed || 'this feed'}”? Its posts are removed too.`;
  }
}
