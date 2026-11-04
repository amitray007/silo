import { Chat, type UIMessage, useChat } from '@ai-sdk/react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
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
import { STREAM_UPDATE_MS } from '../../../lib/motion';
import { toolName, WRITE_TRACES } from './tools';

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
  unknown_action: 'This action was removed. Pick another.',
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
  used?: number;
};

/**
 * One slot per article. Each chat keeps its own `Chat`, so an answer that streams in one chat can
 * never reach another. `active` is the chat on show: an id, `null` for a new chat that has no
 * server row yet, or `undefined` until the newest chat is known.
 */
type Slot = {
  active: string | null | undefined;
  draft: Entry | undefined;
  listeners: Set<() => void>;
  subscribe: (listener: () => void) => () => void;
  select: (active: string | null | undefined) => void;
};
const slots = new Map<string, Slot>();
const chats = new Map<string, Entry>();
let usage = 0;

function pruneChats(current: Entry) {
  const active = new Set([...slots.values()].map((slot) => slot.active));
  const recent = [...chats].filter(
    ([id, entry]) =>
      entry !== current &&
      !active.has(id) &&
      !['streaming', 'submitted'].includes(entry.chat.status),
  );
  recent.sort((a, b) => (b[1].used ?? 0) - (a[1].used ?? 0));
  for (const [id] of recent.slice(8)) chats.delete(id);
}

function slotFor(linkId: string): Slot {
  const cached = slots.get(linkId);
  if (cached) return cached;
  const listeners = new Set<() => void>();
  const slot: Slot = {
    active: undefined,
    draft: undefined,
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
  chats.set(id, entry);
  if (slot.draft === entry) slot.draft = undefined;
  if (slot.active === null) slot.select(id);
}

/** A chat on its own `Chat`, its transport posting to the chat's id once the server row exists. */
function newEntry(client: QueryClient, id: string | null): Entry {
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
}
function entryFor(client: QueryClient, id: string): Entry {
  const cached = chats.get(id);
  if (cached) return cached;
  const entry = newEntry(client, id);
  chats.set(id, entry);
  return entry;
}
function draftFor(client: QueryClient, slot: Slot): Entry {
  slot.draft ??= newEntry(client, null);
  return slot.draft;
}

async function discardEmptyCreatedChat(
  entry: Entry,
  id: string,
  remove: (id: string) => Promise<unknown>,
) {
  const stored = await librarianApi.get(id);
  if (stored.messages.length > 0) {
    entry.chat.messages = stored.messages;
    return false;
  }
  await remove(id);
  chats.delete(id);
  entry.chatId.current = null;
  entry.title = 'New chat';
  return true;
}

type TurnTarget = {
  entry: Entry;
  slot: Slot;
  create: () => Promise<{ id: string }>;
  remove: (id: string) => Promise<unknown>;
  onAdopt: ((id: string) => void) | undefined;
};

function userTurn(text: string, action?: string, passage?: { quote: string; paragraph: number }) {
  return {
    text: text.trim(),
    ...(action || passage ? { metadata: { ...(action ? { action } : {}), ...passage } } : {}),
  };
}

async function recoverRejectedTurn(
  target: TurnTarget,
  previous: UIMessage[],
  createdId: string | undefined,
) {
  const { entry, slot, remove, onAdopt } = target;
  entry.chat.messages = previous;
  if (!createdId) return;
  const discarded =
    previous.length === 0 &&
    (await discardEmptyCreatedChat(entry, createdId, remove).catch(() => false));
  if (discarded) return;
  adopt(slot, entry, createdId);
  onAdopt?.(createdId);
}

async function sendEntryTurn(
  target: TurnTarget,
  text: string,
  action?: string,
  passage?: { quote: string; paragraph: number },
) {
  const { entry, slot, create, onAdopt } = target;
  const { chat, chatId } = entry;
  const previous = chat.messages;
  let createdId: string | undefined;
  const publish = (id: string) => {
    adopt(slot, entry, id);
    onAdopt?.(id);
  };
  const custom = action?.startsWith('custom:');
  if (!chatId.current) {
    const created = await create();
    chatId.current = created.id;
    entry.title = text.trim().slice(0, 60);
    createdId = created.id;
    // Keep a first custom turn in its draft until the server accepts the saved action.
    if (!custom) publish(created.id);
  }
  await chat.sendMessage(userTurn(text, action, passage));
  if (/\bunknown_action\b/.test(chat.error?.message ?? '')) {
    await recoverRejectedTurn(target, previous, createdId);
    return 'unknown_action' as const;
  }
  if (createdId && custom) publish(createdId);
}

/**
 * Everything one chat on show needs: its messages, title, sending (creating the server row on the
 * first send) and approval state. `resolved` is the chat's id, `null` for a new chat, `undefined`
 * while it is still unknown; `linkId` is the article a new chat belongs to, if any.
 */
function useEntryChat({
  entry,
  slot,
  linkId,
  resolved,
  listError,
  onAdopt,
}: {
  entry: Entry;
  slot: Slot;
  linkId: string | undefined;
  resolved: string | null | undefined;
  listError: boolean;
  onAdopt?: (id: string) => void;
}) {
  const create = useCreateLibrarianChat();
  const remove = useDeleteLibrarianChat();
  const { chat, chatId } = entry;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [failedEntry, setFailedEntry] = useState<Entry | null>(null);
  const [creatingEntry, setCreatingEntry] = useState<Entry | null>(null);
  const detail = useLibrarianChatDetail(resolved ?? undefined);
  const state = useChat({ chat, throttle: STREAM_UPDATE_MS });
  useEffect(() => {
    entry.used = ++usage;
    // Reclaim inactive entries when the visible stream settles as well as on navigation.
    if (state.status === 'ready' || state.status === 'error') pruneChats(entry);
  }, [entry, state.status]);
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
  const loading = !listError && !detail.error && (resolved === undefined || !entry.hydrated);
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
    if (!text.trim() || pendingApproval || busy || loading || listError || detail.error) return;
    setFailedEntry(null);
    setCreatingEntry(entry);
    try {
      return await sendEntryTurn(
        {
          entry,
          slot,
          create: () => create.mutateAsync(linkId),
          remove: remove.mutateAsync,
          onAdopt,
        },
        text,
        action,
        passage,
      );
    } catch {
      setFailedEntry(entry);
    } finally {
      setCreatingEntry((current) => (current === entry ? null : current));
    }
  }
  return {
    ...state,
    refresh: rerender,
    title,
    pendingApproval,
    send,
    busy,
    loading,
    failed: failedEntry === entry || !!state.error || listError || !!detail.error,
    errorText: chatErrorText(state.error?.message),
  };
}

/** What a conversation view needs from a chat, whichever hook supplied it. */
export type ThreadChat = ReturnType<typeof useLibrarianPageChat>;

export function useLibrarianChat(linkId: string) {
  const client = useQueryClient();
  const list = useLibrarianChats(linkId);
  const remove = useDeleteLibrarianChat();
  const slot = slotFor(linkId);
  const active = useSyncExternalStore(slot.subscribe, () => slot.active);
  const latest = list.data ? (list.data.chats[0]?.id ?? null) : undefined;
  const resolved = active === undefined ? latest : active;
  useEffect(() => {
    // Pin the newest chat once it is known, so a later refresh cannot swap it under the reader.
    if (slot.active === undefined && latest !== undefined) slot.select(latest);
  }, [slot, latest]);

  // While the newest chat is unknown, the draft stands in; nothing can be sent yet.
  const entry = resolved ? entryFor(client, resolved) : draftFor(client, slot);
  const thread = useEntryChat({ entry, slot, linkId, resolved, listError: !!list.error });
  async function loadImported(id: string) {
    const stored = await librarianApi.get(id);
    const imported = entryFor(client, id);
    imported.chat.messages = stored.messages;
    imported.title = stored.chat.title;
    imported.hydrated = true;
    slot.select(id);
    thread.refresh();
  }
  /** Show another chat. A stream still running in this one carries on, unseen. */
  const open = (id: string) => slot.select(id);
  /** Show an empty chat; its server row waits for the first question. */
  const startNew = () => {
    if (resolved === null) return;
    draftFor(client, slot);
    slot.select(null);
  };
  /** Delete a chat for good. When it is the one on show, `next` takes its place. */
  async function deleteChat(id: string, next: string | null) {
    await remove.mutateAsync(id);
    const wasActive = slot.active === id;
    forgetChat(id);
    if (wasActive) {
      if (next === null) draftFor(client, slot);
      slot.select(next);
    }
  }
  return {
    ...thread,
    loadImported,
    chatId: resolved ?? null,
    open,
    startNew,
    deleteChat,
  };
}

/** A deleted chat stops streaming and leaves every slot. */
export function forgetChat(id: string) {
  void chats.get(id)?.chat.stop();
  chats.delete(id);
  for (const slot of slots.values()) {
    if (slot.active === id) slot.select(undefined);
  }
}

const LIBRARY_PAGE = 'librarian-page';
/**
 * The chat on the Librarian page: `chatId` is the open chat, `null` a new library chat that has no
 * server row until its first question (then `onCreated` hears the new id). The page owns which
 * chat is open; stored conversations share the same cache as the article dock.
 */
export function useLibrarianPageChat(chatId: string | null, onCreated: (id: string) => void) {
  const client = useQueryClient();
  const slot = slotFor(LIBRARY_PAGE);
  // The new chat's id reaches the page's URL a render later; until then it stays on show.
  const [adopted, setAdopted] = useState<string | null>(null);
  useEffect(() => {
    if (chatId) setAdopted(null);
  }, [chatId]);
  const shown = chatId ?? adopted;
  useEffect(() => {
    slot.select(shown);
    return () => slot.select(undefined);
  }, [slot, shown]);
  const entry = shown ? entryFor(client, shown) : draftFor(client, slot);
  return useEntryChat({
    entry,
    slot,
    linkId: undefined,
    resolved: shown,
    listError: false,
    onAdopt: (id) => {
      setAdopted(id);
      onCreated(id);
    },
  });
}

function refreshedReaderIds(message: UIMessage): string[] {
  return message.parts.flatMap((part) => {
    if (toolName(part) !== 'refresh_reader' || !('input' in part)) return [];
    const id = (part.input as { id?: string } | undefined)?.id;
    return id ? [id] : [];
  });
}
