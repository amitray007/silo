import { Chat, type UIMessage, useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { useEffect, useMemo, useState } from 'react';
import { queryKeys } from '../../../api/hooks';
import {
  librarianApi,
  useCreateLibrarianChat,
  useLibrarianChatDetail,
  useLibrarianChats,
} from '../../../api/librarian';
import { toolName, WRITE_TRACES } from './ChatMessage';

const ERROR_WORDS: Record<string, string> = {
  approval_pending: 'Allow or deny the waiting request first.',
  ai_not_ready: 'Turn on the Librarian in Settings first.',
  invalid_key: 'Your AI key was rejected. Check Settings → AI.',
  no_access: 'Your AI key was rejected. Check Settings → AI.',
  model_not_found: 'The chosen model is gone. Pick another in Settings → AI.',
  quota: 'Your AI provider is out of credit or over its limit.',
  rate_limited: 'Your AI provider is busy. Try again in a moment.',
  busy: 'The Librarian is still answering in another tab.',
  timeout: 'The answer took too long. Try again.',
  network: 'Could not reach your AI provider. Try again.',
  unavailable: 'The Librarian is not available on this server.',
};

/** Stream errors carry a fixed code; HTTP errors carry it in a JSON body. */
export function chatErrorText(message: string | undefined): string {
  const code = message?.match(/[a-z_]+/g)?.find((word) => word in ERROR_WORDS);
  return (code && ERROR_WORDS[code]) ?? 'Could not answer. Try again.';
}

const chatsByLink = new Map<
  string,
  { chat: Chat<UIMessage>; chatId: { current: string | null }; title: string }
>();

export function useLibrarianChat(linkId: string) {
  const client = useQueryClient();
  const list = useLibrarianChats(linkId);
  const detail = useLibrarianChatDetail(list.data?.chats[0]?.id);
  const create = useCreateLibrarianChat();

  const [failure, setFailure] = useState(false);
  const [creating, setCreating] = useState(false);
  const entry = useMemo(() => {
    const cached = chatsByLink.get(linkId);
    if (cached) return cached;
    const chatId = { current: null as string | null };
    const chat = new Chat({
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      onFinish: ({ message }) => {
        if (message.parts.some((part) => toolName(part) && WRITE_TRACES[toolName(part) ?? ''])) {
          for (const key of [
            'links',
            'links-recents',
            'links-tag-only',
            'search',
            'link-titles',
            'link',
            'tags',
            'counts',
            'saved-links',
            'trash',
            'trash-search',
            'feeds',
            'feed',
            'feed-posts',
          ])
            void client.invalidateQueries({ queryKey: [key] });
        }
        for (const id of refreshedReaderIds(message))
          void client.invalidateQueries({ queryKey: queryKeys.liveReader(id) });
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
    });
    const entry = { chat, chatId, title: 'New chat' };
    chatsByLink.set(linkId, entry);
    return entry;
  }, [linkId, client]);
  const { chat, chatId } = entry;
  const [title, setTitle] = useState(entry.title);
  const state = useChat({ chat });
  useEffect(() => {
    if (!detail.data) return;
    if (chatId.current && chatId.current !== detail.data.chat.id) return;
    const initial = !chatId.current;
    chatId.current = detail.data.chat.id;
    entry.title = detail.data.chat.title;
    setTitle(entry.title);
    if (
      initial ||
      ((state.status === 'ready' || state.status === 'error') &&
        detail.data.messages.length > chat.messages.length)
    )
      chat.messages = detail.data.messages;
  }, [detail.data, chat, chatId, entry, state.status]);
  const loading = list.isPending || (list.data?.chats.length !== 0 && !chatId.current);
  const busy = creating || state.status === 'submitted' || state.status === 'streaming';
  const lastAssistant = state.messages.findLast((message) => message.role === 'assistant');
  const pendingApproval =
    lastAssistant?.parts.some((part) => 'state' in part && part.state === 'approval-requested') ??
    false;
  async function send(
    text: string,
    action?: string,
    passage?: { quote: string; paragraph: number },
  ) {
    if (!text.trim() || pendingApproval || busy || loading || list.error || detail.error) return;
    setFailure(false);
    setCreating(true);
    try {
      if (!chatId.current) {
        const created = await create.mutateAsync(linkId);
        chatId.current = created.id;
        entry.title = text.trim().slice(0, 60);
        setTitle(entry.title);
      }
      await state.sendMessage({
        text: text.trim(),
        ...(action || passage ? { metadata: { ...(action ? { action } : {}), ...passage } } : {}),
      });
    } catch {
      setFailure(true);
    } finally {
      setCreating(false);
    }
  }
  async function loadImported(id: string) {
    const detail = await librarianApi.get(id);
    chatId.current = id;
    chat.messages = detail.messages;
    entry.title = detail.chat.title;
    setTitle(entry.title);
  }
  return {
    ...state,
    loadImported,
    title,
    pendingApproval,
    send,
    busy,
    loading,
    failed: failure || !!state.error || !!list.error || !!detail.error,
    errorText: chatErrorText(state.error?.message),
  };
}

function refreshedReaderIds(message: UIMessage): string[] {
  return message.parts.flatMap((part) => {
    if (toolName(part) !== 'refresh_reader' || !('input' in part)) return [];
    const id = (part.input as { id?: string } | undefined)?.id;
    return id ? [id] : [];
  });
}
