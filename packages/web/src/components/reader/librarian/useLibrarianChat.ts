import { Chat, useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';
import {
  librarianApi,
  useCreateLibrarianChat,
  useLibrarianChatDetail,
  useLibrarianChats,
} from '../../../api/librarian';

export function useLibrarianChat(linkId: string) {
  const client = useQueryClient();
  const list = useLibrarianChats(linkId);
  const detail = useLibrarianChatDetail(list.data?.chats[0]?.id);
  const create = useCreateLibrarianChat();
  const chatId = useRef<string | null>(null);
  const [title, setTitle] = useState('New chat');
  const [failure, setFailure] = useState(false);
  const [creating, setCreating] = useState(false);
  const [chat] = useState(
    () =>
      new Chat({
        onFinish: () => {
          void client.invalidateQueries({ queryKey: ['librarian'] });
        },
        transport: new DefaultChatTransport({
          credentials: 'include',
          headers: { 'X-Silo-CSRF': '1' },
          prepareSendMessagesRequest: ({ messages }) => {
            if (!chatId.current) throw new Error('Chat is not ready');
            return {
              api: librarianApi.messagesUrl(chatId.current),
              body: { message: messages.at(-1) },
            };
          },
        }),
      }),
  );
  const state = useChat({ chat });
  useEffect(() => {
    if (!detail.data || chatId.current) return;
    chatId.current = detail.data.chat.id;
    setTitle(detail.data.chat.title);
    chat.messages = detail.data.messages;
  }, [detail.data, chat]);
  const loading = list.isPending || (list.data?.chats.length !== 0 && !chatId.current);
  const busy = creating || state.status === 'submitted' || state.status === 'streaming';
  async function send(text: string, action?: string) {
    if (!text.trim() || busy || loading || list.error || detail.error) return;
    setFailure(false);
    setCreating(true);
    try {
      if (!chatId.current) {
        const created = await create.mutateAsync(linkId);
        chatId.current = created.id;
        setTitle(text.trim().slice(0, 60));
      }
      await state.sendMessage({ text: text.trim(), ...(action ? { metadata: { action } } : {}) });
    } catch {
      setFailure(true);
    } finally {
      setCreating(false);
    }
  }
  return {
    ...state,
    title,
    send,
    busy,
    loading,
    failed: failure || !!state.error || !!list.error || !!detail.error,
  };
}
