import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { useLibrarianReady } from '../api/librarian';
import { ListPaneDivider } from '../components/reader/ListPaneDivider';
import { ChatList } from '../components/reader/librarian/ChatList';
import { ChatPane } from '../components/reader/librarian/ChatPane';
import { ReaderIcon } from '../components/reader/ReaderIcon';
import { layoutMedia, useMediaQuery } from '../lib/breakpoints';
import { NEW_CHAT, useChatParam } from '../lib/useChatParam';
import { useEscapeLayer } from '../lib/useEscapeLayer';
import { useListWidth } from '../lib/useListWidth';
import { ContentFrame } from './shared/ListHeader';

function NewChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="silo-reader-iconbtn"
      aria-label="New chat"
      title="New chat"
      onClick={onClick}
    >
      <ReaderIcon name="plus" />
    </button>
  );
}

function NoChatOpen() {
  return (
    <section className="silo-readerpane" aria-label="Librarian chat">
      <div className="silo-panehead" aria-hidden="true" />
      <div className="silo-empty-reader">
        <div>
          <ReaderIcon name="librarian" />
          <p>Select a chat</p>
          <span>Or start a new one with +.</span>
        </div>
      </div>
    </section>
  );
}

/**
 * `/librarian` — every chat with the Librarian, article or not. The list sits where the Library's
 * does and the open chat takes the reader's place; below 1024px the chat covers the list, with Back.
 */
export function LibrarianView() {
  const ready = useLibrarianReady();
  if (!ready)
    return (
      <p>
        Turn on the Librarian in{' '}
        <Link to="/" state={{ settingsTab: 'ai' }}>
          Settings → AI
        </Link>
        .
      </p>
    );
  return <ReadyLibrarianView />;
}

function ReadyLibrarianView() {
  const { open, chatId, show, close } = useChatParam();
  const fullWindow = useMediaQuery(layoutMedia.fullWindowReader);
  const [listWidth] = useListWidth();
  // Escape leaves a chat that covers the whole window, the way it leaves the reader.
  useEscapeLayer(fullWindow && open, close);
  return (
    <div
      className="silo-three-pane"
      data-reader={open}
      style={{ '--list-w': `${listWidth}px` } as CSSProperties}
    >
      <section
        tabIndex={-1}
        className="silo-listpane"
        aria-label="Chats"
        inert={fullWindow && open}
      >
        <ContentFrame
          title="Librarian"
          headerSlot={<NewChatButton onClick={() => show(NEW_CHAT)} />}
        >
          <ChatList
            selectedId={chatId}
            onOpen={(id) => show(id)}
            onDeleted={(id, next) => {
              if (id === chatId) show(next, true);
            }}
          />
        </ContentFrame>
      </section>
      <ListPaneDivider width={listWidth} fullWindow={fullWindow} />
      {open ? (
        <ChatPane autoFocus chatId={chatId} onBack={close} onCreated={(id) => show(id, true)} />
      ) : (
        <NoChatOpen />
      )}
    </div>
  );
}
