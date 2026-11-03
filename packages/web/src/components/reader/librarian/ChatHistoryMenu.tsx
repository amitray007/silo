import { useEffect, useRef, useState } from 'react';
import { type ChatSummary, useLibrarianHistory } from '../../../api/librarian';
import { relativeTimeFromNow } from '../../../lib/relativeTime';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { MenuSurface } from '../../MenuSurface';
import { Spinner } from '../../Spinner';
import { ReaderIcon } from '../ReaderIcon';
import { onHistoryKey, PICK, pickButtons } from './historyKeys';

/** Loads the next page when the end of the list scrolls into view. */
function useNextPageOnScroll(
  list: React.RefObject<HTMLDivElement | null>,
  end: React.RefObject<HTMLLIElement | null>,
  { enabled, load }: { enabled: boolean; load: () => void },
) {
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    const node = end.current;
    if (!enabled || !node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { root: list.current, rootMargin: '0px 0px 80px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, list, end]);
}

export function ChatHistoryMenu({
  linkId,
  currentId,
  onPick,
  onDelete,
  onClose,
}: {
  linkId: string;
  currentId: string | null;
  onPick: (id: string) => void;
  /** `next` is the chat to show when the deleted one is the open chat. */
  onDelete: (id: string, next: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const history = useLibrarianHistory(linkId, true);
  const list = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLLIElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history;
  const seen = new Set<string>();
  // A chat that moved between pages while the list refreshed must not show twice.
  const chats: ChatSummary[] = (history.data?.pages ?? [])
    .flatMap((page) => page.chats)
    .filter((chat) => !seen.has(chat.id) && seen.add(chat.id));

  useNextPageOnScroll(list, end, {
    enabled: hasNextPage && !isFetchingNextPage,
    load: () => void fetchNextPage(),
  });
  // Escape cancels a pending delete before it closes the menu.
  useEscapeLayer(confirming !== null, () => setConfirming(null));

  // The menu opens before its chats arrive; once they do, keys start on the open chat.
  const firstRows = chats.length > 0;
  useEffect(() => {
    if (!firstRows) return;
    const inside = list.current?.contains(document.activeElement);
    if (inside) return;
    const rows = pickButtons(list.current);
    (rows.find((row) => row.getAttribute('aria-current') === 'true') ?? rows[0])?.focus({
      preventScroll: false,
    });
  }, [firstRows]);

  // Focus follows the confirmation: Cancel when it opens, the row's pick button when it closes.
  const confirmed = useRef<string | null>(null);
  useEffect(() => {
    const row = confirming ?? confirmed.current;
    if (!row) return;
    const node = list.current?.querySelector<HTMLElement>(`[data-chat="${row}"]`);
    if (confirming) node?.querySelector<HTMLElement>('[data-cancel]')?.focus();
    else if (!node?.contains(document.activeElement))
      node?.querySelector<HTMLElement>(PICK)?.focus();
    confirmed.current = confirming;
  }, [confirming]);

  const askDelete = (id: string) => {
    setDeleteFailed(false);
    setConfirming(id);
  };

  async function remove(chat: ChatSummary) {
    const index = chats.findIndex((item) => item.id === chat.id);
    const next = chats[index + 1] ?? chats[index - 1] ?? null;
    const neighbour =
      next && list.current?.querySelector<HTMLElement>(`[data-chat="${next.id}"] ${PICK}`);
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await onDelete(chat.id, next?.id ?? null);
      confirmed.current = null;
      setConfirming(null);
      // The row is gone; keep the keyboard where the list continues.
      if (neighbour) neighbour.focus();
      else onClose();
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <MenuSurface
      className="silo-chat-history"
      role="dialog"
      label="Chat history"
      sheet={false}
      onClose={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the scroller only routes keys from its buttons. */}
      <div
        className="silo-chat-history-scroll"
        ref={list}
        onKeyDown={(event) => onHistoryKey(event, askDelete)}
      >
        {history.isPending && <Spinner label="Loading chats" minHeight={96} />}
        {history.isError && (
          <p className="silo-chat-history-note" role="alert">
            Could not load your chats.{' '}
            <button type="button" onClick={() => void history.refetch()}>
              Try again
            </button>
          </p>
        )}
        {history.isSuccess && chats.length === 0 && (
          <p className="silo-chat-history-note">No saved chats for this article yet.</p>
        )}
        {chats.length > 0 && (
          <ul>
            {chats.map((chat) => {
              const title = chat.title.trim() || 'New chat';
              return (
                <li
                  key={chat.id}
                  data-chat={chat.id}
                  data-current={chat.id === currentId || undefined}
                  data-confirming={confirming === chat.id || undefined}
                >
                  {confirming === chat.id ? (
                    <div className="silo-chat-history-confirm">
                      <span role={deleteFailed ? 'alert' : undefined}>
                        {deleteFailed ? 'Could not delete.' : 'Delete this chat?'}
                      </span>
                      <button
                        type="button"
                        className="silo-chat-history-yes"
                        disabled={deleting}
                        onClick={() => void remove(chat)}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        data-cancel
                        disabled={deleting}
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="silo-chat-history-pick"
                        aria-current={chat.id === currentId ? 'true' : undefined}
                        onClick={() => onPick(chat.id)}
                      >
                        <span className="silo-chat-history-title">{title}</span>
                        <time dateTime={chat.updatedAt}>{relativeTimeFromNow(chat.updatedAt)}</time>
                      </button>
                      <button
                        type="button"
                        className="silo-chat-history-del"
                        aria-label={`Delete chat: ${title}`}
                        title="Delete chat"
                        onClick={() => askDelete(chat.id)}
                      >
                        <ReaderIcon name="trash" size={16} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
            {hasNextPage && <li ref={end} className="silo-chat-history-end" aria-hidden="true" />}
          </ul>
        )}
        {isFetchingNextPage && <Spinner label="Loading more chats" minHeight={40} />}
      </div>
    </MenuSurface>
  );
}
