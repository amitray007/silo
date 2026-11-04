import { type MouseEvent, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { type ChatSummary, useLibrarianAllChats } from '../api/librarian';
import { chatTo, NEW_CHAT } from '../lib/useChatParam';
import { NavItem } from './NavItem';
import { ReaderIcon } from './reader/ReaderIcon';
import { SectionCaret } from './SectionCaret';

const RECENT_CHATS = 5;

/** A plain click opens in place; a modified click keeps the browser's own new-tab behavior. */
function isPlainClick(event: MouseEvent) {
  return !(event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/** Recent Librarian chats and a new-chat row. Shown only when the Librarian is ready. */
export function SidebarChats({ onNavigate }: { onNavigate: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const activeId = useSearchParams()[0].get('chat');
  const all = useLibrarianAllChats();
  const recent = (all.data?.pages[0]?.chats ?? []).slice(0, RECENT_CHATS);

  const open = (to: string) => (event: MouseEvent) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    navigate(to);
    onNavigate();
  };
  const row = (chat: ChatSummary) => {
    const to = chatTo(location, chat.id);
    const title = chat.title.trim() || 'New chat';
    return (
      <NavItem
        key={chat.id}
        href={to}
        title={title}
        label={title}
        variant="tag"
        active={chat.id === activeId}
        icon={<ReaderIcon name={chat.linkId ? 'page' : 'librarian'} />}
        onClick={open(to)}
      />
    );
  };
  const newChat = chatTo(location, NEW_CHAT);

  return (
    <div className="silo-tags" data-expanded={expanded}>
      <div className="silo-tags-header">
        <div className="silo-tags-title">
          <button
            type="button"
            className="silo-tags-toggle"
            aria-expanded={expanded}
            aria-controls="silo-chat-list"
            onClick={() => setExpanded(!expanded)}
          >
            <span className="silo-tags-label">Chats</span>
            <SectionCaret expanded={expanded} />
          </button>
        </div>
      </div>
      {expanded && (
        <div id="silo-chat-list" className="silo-tags-body">
          <NavItem
            href={newChat}
            title="New chat"
            label="New chat"
            variant="tag"
            icon={<ReaderIcon name="plus" />}
            onClick={open(newChat)}
          />
          <section className="silo-tag-scroll" aria-label="Recent chats" aria-busy={all.isLoading}>
            {recent.map(row)}
          </section>
        </div>
      )}
    </div>
  );
}
