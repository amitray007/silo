import { Chat, type UIMessage, useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { queryKeys } from '../../../api/hooks';
import {
  librarianApi,
  useCreateLibrarianChat,
  useDeleteLibrarianChat,
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

type Entry = {
  chat: Chat<UIMessage>;
  chatId: { current: string | null };
  title: string;
  /** The stored messages are in the chat (or the chat is new and has none to load). */
  hydrated: boolean;
};

/**
 * One slot per article. Each chat keeps its own `Chat`, so an answer that streams in one chat can
 * never reach another. `active` is the chat on show: an id, `null` for a new chat that has no
 * server row yet, or `undefined` until the newest chat is known.
 */
type Slot = {
  active: string | null | undefined;
  draft: Entry | undefined;
  byId: Map<string, Entry>;
  listeners: Set<() => void>;
  subscribe: (listener: () => void) => () => void;
  select: (active: string | null) => void;
};
const slots = new Map<string, Slot>();

function slotFor(linkId: string): Slot {
  const cached = slots.get(linkId);
  if (cached) return cached;
  const listeners = new Set<() => void>();
  const slot: Slot = {
    active: undefined,
    draft: undefined,
    byId: new Map(),
    listeners,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select: (active) => {
      if (slot.active === active) return;
      slot.active = active;
      for (const listener of listeners) listener();
    },
  };
  slots.set(linkId, slot);
  return slot;
}

/** The server row exists now: the draft becomes an ordinary chat. */
function adopt(slot: Slot, entry: Entry, id: string) {
  slot.byId.set(id, entry);
  if (slot.draft === entry) slot.draft = undefined;
  if (slot.active === null) slot.select(id);
}

export function useLibrarianChat(linkId: string) {
  const client = useQueryClient();
  const list = useLibrarianChats(linkId);
  const create = useCreateLibrarianChat();
  const remove = useDeleteLibrarianChat();
  const slot = slotFor(linkId);
  const active = useSyncExternalStore(slot.subscribe, () => slot.active);
  const latest = list.data ? (list.data.chats[0]?.id ?? null) : undefined;
  const resolved = active === undefined ? latest : active;
  useEffect(() => {
    // Pin the newest chat once it is known, so a later refresh cannot swap it under the reader.
    if (slot.active === undefined && latest !== undefined) slot.select(latest);
  }, [slot, latest]);

  const newEntry = (id: string | null): Entry => {
    const chatId = { current: id };
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
    return { chat, chatId, title: 'New chat', hydrated: id === null };
  };
  const entryFor = (id: string): Entry => {
    const cached = slot.byId.get(id);
    if (cached) return cached;
    const entry = newEntry(id);
    slot.byId.set(id, entry);
    return entry;
  };
  const draft = (): Entry => {
    slot.draft ??= newEntry(null);
    return slot.draft;
  };
  // While the newest chat is unknown, the draft stands in; nothing can be sent yet.
  const entry = resolved ? entryFor(resolved) : draft();
  const { chat, chatId } = entry;

  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [failedEntry, setFailedEntry] = useState<Entry | null>(null);
  const [creatingEntry, setCreatingEntry] = useState<Entry | null>(null);
  const detail = useLibrarianChatDetail(resolved ?? undefined);
  const state = useChat({ chat });
  useEffect(() => {
    const data = detail.data;
    if (!data || data.chat.id !== chatId.current) return;
    entry.title = data.chat.title;
    if (
      !entry.hydrated ||
      ((state.status === 'ready' || state.status === 'error') &&
        data.messages.length > chat.messages.length)
    ) {
      chat.messages = data.messages;
      entry.hydrated = true;
      rerender();
    }
  }, [detail.data, chat, chatId, entry, state.status]);
  const title =
    detail.data && detail.data.chat.id === chatId.current ? detail.data.chat.title : entry.title;
  const loading = resolved === undefined || !entry.hydrated;
  const busy =
    creatingEntry === entry || state.status === 'submitted' || state.status === 'streaming';
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
    setFailedEntry(null);
    setCreatingEntry(entry);
    try {
      if (!chatId.current) {
        const created = await create.mutateAsync(linkId);
        chatId.current = created.id;
        entry.title = text.trim().slice(0, 60);
        adopt(slot, entry, created.id);
      }
      await state.sendMessage({
        text: text.trim(),
        ...(action || passage ? { metadata: { ...(action ? { action } : {}), ...passage } } : {}),
      });
    } catch {
      setFailedEntry(entry);
    } finally {
      setCreatingEntry((current) => (current === entry ? null : current));
    }
  }
  async function loadImported(id: string) {
    const stored = await librarianApi.get(id);
    const imported = entryFor(id);
    imported.chat.messages = stored.messages;
    imported.title = stored.chat.title;
    imported.hydrated = true;
    slot.select(id);
    rerender();
  }
  /** Show another chat. A stream still running in this one carries on, unseen. */
  const open = (id: string) => slot.select(id);
  /** Show an empty chat; its server row waits for the first question. */
  const startNew = () => {
    if (resolved === null) return;
    draft();
    slot.select(null);
  };
  /** Delete a chat for good. When it is the one on show, `next` takes its place. */
  async function deleteChat(id: string, next: string | null) {
    await remove.mutateAsync(id);
    slot.byId.get(id)?.chat.stop();
    slot.byId.delete(id);
    if (resolved === id) {
      if (next === null) draft();
      slot.select(next);
    }
  }
  return {
    ...state,
    loadImported,
    title,
    chatId: resolved ?? null,
    open,
    startNew,
    deleteChat,
    pendingApproval,
    send,
    busy,
    loading,
    failed: failedEntry === entry || !!state.error || !!list.error || !!detail.error,
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
