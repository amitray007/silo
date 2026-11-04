import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type ChatSummary,
  useDeleteLibrarianChat,
  useLibrarianAllChats,
} from '../../../api/librarian';
import { bucketByDay } from '../../../lib/buckets';
import { relativeTimeFromNow } from '../../../lib/relativeTime';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { useIntersectionPrefetch } from '../../../lib/useIntersectionPrefetch';
import { EmptyState, LoadingState } from '../../../routes/shared/ListStates';
import { DayGroupHeading } from '../../DayGroupHeading';
import { Spinner } from '../../Spinner';
import { ReaderIcon } from '../ReaderIcon';
import { type ListSelectors, onHistoryKey } from './historyKeys';
import { forgetChat } from './useLibrarianChat';

const PICK = '[data-chat-pick]';
const KEYS: ListSelectors = {
  pick: PICK,
  del: '[data-chat-del]',
  confirm: '.silo-chat-history-confirm button',
};

function ChatRow({
  chat,
  selected,
  confirming,
  deleting,
  deleteFailed,
  onOpen,
  onAskDelete,
  onCancel,
  onDelete,
}: {
  chat: ChatSummary;
  selected: boolean;
  confirming: boolean;
  deleting: boolean;
  deleteFailed: boolean;
  onOpen: () => void;
  onAskDelete: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const title = chat.title.trim() || 'New chat';
  const source = chat.linkTitle?.trim() || 'Library';
  return (
    <li
      className="silo-row-wrap silo-chat-item"
      data-chat={chat.id}
      data-confirming={confirming || undefined}
    >
      {confirming ? (
        <div className="silo-link-row silo-chat-row">
          <div className="silo-chat-history-confirm">
            <span role={deleteFailed ? 'alert' : undefined}>
              {deleteFailed ? 'Could not delete.' : 'Delete this chat?'}
            </span>
            <button
              type="button"
              className="silo-chat-history-yes"
              disabled={deleting}
              onClick={onDelete}
            >
              Delete
            </button>
            <button type="button" data-cancel disabled={deleting} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="silo-link-row silo-chat-row"
            data-chat-pick
            data-active={selected}
            aria-current={selected ? 'true' : undefined}
            onClick={onOpen}
          >
            <span className="silo-row-titleline">
              <span className="silo-row-iconwrap">
                <ReaderIcon name={chat.linkId ? 'page' : 'library'} />
              </span>
              <span className="silo-row-title">{title}</span>
            </span>
            <span className="silo-row-meta">
              <span>{source}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={chat.updatedAt}>{relativeTimeFromNow(chat.updatedAt)}</time>
            </span>
          </button>
          <span className="silo-row-actions">
            <button
              type="button"
              className="silo-reader-iconbtn"
              data-chat-del
              aria-label={`Delete chat: ${title}`}
              title="Delete chat"
              onClick={onAskDelete}
            >
              <ReaderIcon name="trash" />
            </button>
          </span>
        </>
      )}
    </li>
  );
}

/**
 * Every chat, newest first and grouped by day, loaded a page at a time as the list scrolls.
 * `onDeleted` hears the id of a deleted chat and the chat that follows it, so the page can move
 * on when the open chat goes.
 */
export function ChatList({
  selectedId,
  onOpen,
  onDeleted,
}: {
  selectedId: string | null;
  onOpen: (id: string) => void;
  onDeleted: (id: string, next: string | null) => void;
}) {
  const history = useLibrarianAllChats();
  const remove = useDeleteLibrarianChat();
  const list = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history;
  const chats = useMemo(() => {
    const seen = new Set<string>();
    // A chat that moved between pages while the list refreshed must not show twice.
    return (history.data?.pages ?? [])
      .flatMap((page) => page.chats)
      .filter((chat) => !seen.has(chat.id) && seen.add(chat.id));
  }, [history.data]);
  const groups = useMemo(
    () => bucketByDay(chats.map((chat) => ({ chat, createdAt: chat.updatedAt }))),
    [chats],
  );
  const sentinel = useIntersectionPrefetch(() => void fetchNextPage(), {
    enabled: Boolean(hasNextPage) && !isFetchingNextPage,
  });
  // Escape cancels a pending delete before anything else closes.
  useEscapeLayer(confirming !== null, () => setConfirming(null));

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

  async function deleteChat(chat: ChatSummary) {
    const index = chats.findIndex((item) => item.id === chat.id);
    const next = chats[index + 1] ?? chats[index - 1] ?? null;
    const neighbour =
      next && list.current?.querySelector<HTMLElement>(`[data-chat="${next.id}"] ${PICK}`);
    setDeleteFailed(false);
    try {
      await remove.mutateAsync(chat.id);
      forgetChat(chat.id);
      confirmed.current = null;
      setConfirming(null);
      // The row is gone; keep the keyboard where the list continues.
      neighbour?.focus();
      onDeleted(chat.id, next?.id ?? null);
    } catch {
      setDeleteFailed(true);
    }
  }

  if (history.isPending) return <LoadingState />;
  if (history.isError)
    return (
      <p className="silo-chat-list-note" role="alert">
        Couldn't load your chats.{' '}
        <button type="button" onClick={() => void history.refetch()}>
          Try again
        </button>
      </p>
    );
  if (chats.length === 0) return <EmptyState title="No chats yet" body="Use + to start one." />;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the list only routes keys from its buttons.
    <div
      className="silo-chat-list"
      ref={list}
      onKeyDown={(event) =>
        onHistoryKey(
          event,
          (id) => {
            setDeleteFailed(false);
            setConfirming(id);
          },
          KEYS,
        )
      }
    >
      {groups.map((group) => (
        <div key={group.label}>
          <DayGroupHeading label={group.label} />
          <ul className="silo-chat-group">
            {group.items.map(({ chat }) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                selected={chat.id === selectedId}
                confirming={confirming === chat.id}
                deleting={remove.isPending}
                deleteFailed={deleteFailed}
                onOpen={() => onOpen(chat.id)}
                onAskDelete={() => {
                  setDeleteFailed(false);
                  setConfirming(chat.id);
                }}
                onCancel={() => setConfirming(null)}
                onDelete={() => void deleteChat(chat)}
              />
            ))}
          </ul>
        </div>
      ))}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      {isFetchingNextPage && <Spinner label="Loading more chats" minHeight={56} />}
    </div>
  );
}
