import { useEffect } from 'react';
import { Link } from 'react-router';
import {
  useArticleChips,
  useLibrarianAllChats,
  useLibrarianChatDetail,
  useLibraryChips,
} from '../../../api/librarian';
import { ReaderIcon } from '../ReaderIcon';
import { ChatThread, useChatComposer } from './ChatThread';
import { useLibrarianPageChat } from './useLibrarianChat';

/** The article a chat belongs to, from the loaded list or, for a chat opened by link, its detail. */
function useChatArticle(chatId: string | null) {
  const all = useLibrarianAllChats();
  const detail = useLibrarianChatDetail(chatId ?? undefined);
  const listed = all.data?.pages.flatMap((page) => page.chats).find((chat) => chat.id === chatId);
  const linkId = listed?.linkId ?? detail.data?.chat.linkId ?? null;
  return { linkId, linkTitle: listed?.linkTitle ?? null };
}

/**
 * The open chat on the Librarian page: a header with the title and, for an article chat, a way
 * into the Reader, then the same messages and composer as the dock. `chatId` is `null` for a new
 * library chat, whose row is created on its first question.
 */
export function ChatPane({
  chatId,
  onBack,
  onCreated,
}: {
  chatId: string | null;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const chat = useLibrarianPageChat(chatId, onCreated);
  const article = useChatArticle(chatId);
  const composer = useChatComposer();
  const articleActions = useArticleChips();
  const libraryActions = useLibraryChips();
  const { setInput, setPassage, field } = composer;
  // A question typed in one chat is not carried into another.
  useEffect(() => {
    setInput('');
    setPassage(undefined);
    if (chatId === null) field.current?.focus();
  }, [chatId, setInput, setPassage, field]);
  return (
    <section className="silo-readerpane silo-chatpage" aria-label="Librarian chat">
      <header className="silo-panehead silo-chatpage-head">
        <button
          type="button"
          className="silo-reader-iconbtn silo-chatpage-back"
          aria-label="Back to chats"
          title="Back to chats"
          onClick={onBack}
        >
          <ReaderIcon name="back" />
        </button>
        <h2>{chat.title}</h2>
        <span className="silo-pane-spacer" />
        {article.linkId && (
          <Link
            className="silo-chatpage-article"
            to={`/?link=${article.linkId}`}
            title="Open in the Reader"
            aria-label={`Open article: ${article.linkTitle ?? 'this article'}`}
          >
            <span>{article.linkTitle ?? 'Open article'}</span>
            <ReaderIcon name="arrowUpRight" size={16} />
          </Link>
        )}
      </header>
      <ChatThread
        variant="page"
        chat={chat}
        composer={composer}
        linkId={article.linkId ?? undefined}
        actions={article.linkId ? articleActions : libraryActions}
        emptyText={
          article.linkId ? 'Ask about this article or your library.' : 'Ask about your library.'
        }
        header={null}
      />
    </section>
  );
}
