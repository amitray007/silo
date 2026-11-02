import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { MenuPresence } from '../../MenuPresence';
import { ReaderIcon } from '../ReaderIcon';
import { ChatHistoryMenu } from './ChatHistoryMenu';
import { ARTICLE_ACTIONS, ChatThread, useChatComposer } from './ChatThread';
import { clearDockRequest, useDockRequest } from './selectionStore';
import { useLibrarianChat } from './useLibrarianChat';

const HISTORY_SCOPE = '.silo-chat-history, [data-chat-history-trigger]';
/** Below this much room under the title, the history menu opens upward instead. */
const HISTORY_ROOM = 280;
const HISTORY_GAP = 8;
const HISTORY_MARGIN = 16;
const HISTORY_MAX = 440;

/** Places the open history menu: down over the panel when it has room, otherwise up above it.
 *  Written as data on the chat root so the menu's CSS reads it without a re-render. */
function useHistoryPlacement(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  title: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const node = root.current;
    if (!open || !node) return;
    const place = () => {
      const bounds = panel.current?.getBoundingClientRect();
      const trigger = title.current?.getBoundingClientRect();
      if (!bounds || !trigger) return;
      // The panel ends above the chat input, so the room below the title is the room that
      // keeps the input uncovered.
      const below = bounds.bottom - trigger.bottom - HISTORY_GAP;
      const above = bounds.top - HISTORY_GAP - HISTORY_MARGIN;
      const up = below < HISTORY_ROOM && above > below;
      node.dataset.history = up ? 'up' : 'down';
      node.style.setProperty(
        '--silo-history-max',
        `${Math.floor(Math.max(120, Math.min(up ? above : below, up ? HISTORY_MAX : 320)))}px`,
      );
    };
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      delete node.dataset.history;
      node.style.removeProperty('--silo-history-max');
    };
  }, [open, root, panel, title]);
}

function usePanelHeight(panel: HTMLElement | null) {
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    if (!panel) return;
    const update = () =>
      setHeight(Math.max(0, Math.min(panel.clientHeight * 0.62, panel.clientHeight - 120)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [panel]);
  return height;
}
export function DockChat({
  linkId,
  onFold,
  panel = null,
}: {
  linkId: string;
  onFold: () => void;
  panel?: HTMLElement | null;
}) {
  const maxHeight = usePanelHeight(panel);
  const chat = useLibrarianChat(linkId);
  const [importError, setImportError] = useState(false);
  const request = useDockRequest(linkId);
  const composer = useChatComposer(request?.passage);
  const { setInput, setPassage, field } = composer;
  useEffect(() => {
    if (!request) return;
    field.current?.focus();
    if (request.chatId) void chat.loadImported(request.chatId).catch(() => setImportError(true));
    setPassage(request.passage);
    if (request.question) {
      if (chat.loading || chat.busy || chat.pendingApproval) {
        setInput(request.question);
      } else {
        void chat.send(request.question, undefined, request.passage);
        setPassage(undefined);
      }
    }
    clearDockRequest(linkId);
  }, [
    request,
    chat.loading,
    chat.busy,
    chat.send,
    chat.loadImported,
    chat.pendingApproval,
    linkId,
    field,
    setInput,
    setPassage,
  ]);
  const titleButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useHistoryPlacement(historyOpen, root, sheet, titleButton);
  useEscapeLayer(true, onFold);
  useEffect(() => {
    if (!historyOpen) return;
    // A press anywhere else in the chat counts as leaving the menu.
    const leave = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest(HISTORY_SCOPE))
        setHistoryOpen(false);
    };
    document.addEventListener('mousedown', leave);
    return () => document.removeEventListener('mousedown', leave);
  }, [historyOpen]);
  const closeHistory = () => {
    setHistoryOpen(false);
    titleButton.current?.focus();
  };
  useEffect(() => {
    field.current?.focus();
  }, [field]);
  return (
    <ChatThread
      chat={chat}
      composer={composer}
      linkId={linkId}
      actions={ARTICLE_ACTIONS}
      emptyText="Ask about this article or your library."
      rootRef={root}
      panelRef={sheet}
      maxHeight={maxHeight}
      onBack={onFold}
      header={
        <header>
          <h3>
            <button
              ref={titleButton}
              type="button"
              className="silo-chat-title"
              title="Chat history"
              aria-haspopup="dialog"
              aria-expanded={historyOpen}
              data-chat-history-trigger
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <span>{chat.title}</span>
              <ReaderIcon name="down" size={14} />
            </button>
          </h3>
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label="New chat"
            title="New chat"
            onClick={() => {
              setHistoryOpen(false);
              chat.startNew();
              field.current?.focus();
            }}
          >
            <ReaderIcon name="plus" size={18} />
          </button>
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label="Fold chat"
            title="Fold back (Esc)"
            onClick={onFold}
          >
            <ReaderIcon name="minus" size={18} />
          </button>
        </header>
      }
      notice={
        importError && (
          <p role="alert">Could not load the imported answer. Reopen Librarian to try again.</p>
        )
      }
      menu={
        <MenuPresence>
          {historyOpen && (
            <ChatHistoryMenu
              linkId={linkId}
              currentId={chat.chatId}
              onPick={(id) => {
                chat.open(id);
                closeHistory();
              }}
              onDelete={chat.deleteChat}
              onClose={closeHistory}
            />
          )}
        </MenuPresence>
      }
    />
  );
}
