import type { UIMessage } from '@ai-sdk/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { articleChips, libraryChips, resolveActions } from '../lib/librarianActions';
import { ApiError, apiDelete, apiGet, apiPost, apiUrl } from './client';
import { queryKeys, useAi, useSettings } from './hooks';

export type ChatSummary = {
  id: string;
  title: string;
  linkId: string | null;
  /** The article's title; null for a library chat or an article that is gone. */
  linkTitle?: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ChatPage = { chats: ChatSummary[]; nextCursor: string | null };
const CHAT_PAGE_SIZE = 20;
export type ChatDetail = { chat: ChatSummary; messages: UIMessage[] };
export const librarianApi = {
  /** One article's chats, or every chat when `linkId` is null. */
  list: (linkId: string | null, limit = 1, cursor?: string) =>
    apiGet<ChatPage>(
      `/api/librarian/chats?${new URLSearchParams({
        ...(linkId ? { linkId } : {}),
        limit: String(limit),
        ...(cursor ? { cursor } : {}),
      })}`,
    ),
  /** A chat tied to an article, or a library chat when `linkId` is omitted. */
  create: (linkId?: string) =>
    apiPost<ChatSummary>('/api/librarian/chats', linkId ? { linkId } : {}),
  get: (id: string) => apiGet<ChatDetail>(`/api/librarian/chats/${id}`),
  delete: (id: string) => apiDelete(`/api/librarian/chats/${id}`),
  messagesUrl: (id: string) => apiUrl(`/api/librarian/chats/${id}/messages`),
};
/** Whether the Librarian can answer: AI on, the feature on and a model chosen. Ask and its page show only then. */
export function useLibrarianReady() {
  const { data } = useAi();
  return data?.status?.features?.librarian?.ready === true;
}
/** The newest chat for an article: what Ask reopens, and whether the dock Ask shows its dot. */
export function useLibrarianChats(linkId: string, enabled = true) {
  return useQuery({
    queryKey: ['librarian', 'list', linkId],
    queryFn: () => librarianApi.list(linkId),
    enabled,
  });
}
/** Whether the article has a stored chat: the dock Ask shows a dot for it. */
export function useHasLibrarianChat(linkId: string, enabled: boolean) {
  return (useLibrarianChats(linkId, enabled).data?.chats.length ?? 0) > 0;
}
/** Every chat for an article, newest first, in cursor pages. */
export function useLibrarianHistory(linkId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['librarian', 'history', linkId],
    queryFn: ({ pageParam }) => librarianApi.list(linkId, CHAT_PAGE_SIZE, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });
}
/** Every chat, article or not, newest first, in cursor pages: the Librarian page's list. */
export function useLibrarianAllChats(enabled = true) {
  return useInfiniteQuery({
    queryKey: ['librarian', 'all'],
    queryFn: ({ pageParam }) => librarianApi.list(null, CHAT_PAGE_SIZE, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });
}
export function useDeleteLibrarianChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: librarianApi.delete,
    onSuccess: (_, id) => {
      client.removeQueries({ queryKey: ['librarian', 'chat', id] });
      return client.invalidateQueries({ queryKey: ['librarian'] });
    },
  });
}
export function useLibrarianChatDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['librarian', 'chat', id],
    queryFn: () => librarianApi.get(id ?? ''),
    enabled: id !== undefined,
  });
}
export function useCreateLibrarianChat() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: librarianApi.create,
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['librarian', 'list'] }),
        client.invalidateQueries({ queryKey: ['librarian', 'all'] }),
      ]),
  });
}

export function useImportLibrarianTurn() {
  const client = useQueryClient();
  return useMutation({
    /** Continue starts its own chat, so the passage turn never lands in an ongoing conversation. */
    mutationFn: async ({ linkId, messages }: { linkId: string; messages: UIMessage[] }) => {
      const chat = await librarianApi.create(linkId);
      try {
        await apiPost(`/api/librarian/chats/${chat.id}/import`, { messages });
      } catch (error) {
        // Leave no empty chat behind when the import is refused.
        await librarianApi.delete(chat.id).catch(() => {});
        throw error;
      }
      return chat.id;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['librarian'] }),
  });
}

/** The owner's quick actions, resolved: the stored value, or the defaults while it is missing. */
export function useLibrarianActions() {
  const { data } = useSettings({ staleTime: 60_000 });
  return useMemo(() => resolveActions(data?.librarianActions), [data?.librarianActions]);
}

/** Whether the Librarian suggests follow-ups after an answer, from Settings -> AI (on by default). */
export function useSuggestFollowups(): boolean {
  const { data } = useSettings({ staleTime: 60_000 });
  return data?.librarianSuggestions !== false;
}

/** Whether Librarian answers arrive as they stream or whole, from Settings -> AI. */
export function useChatAnswers(): 'streamed' | 'complete' {
  const { data } = useSettings({ staleTime: 60_000 });
  return data?.chatAnswers ?? 'streamed';
}

/** The chips of an empty article chat, from the owner's article list. */
export function useArticleChips() {
  const actions = useLibrarianActions();
  return useMemo(() => articleChips(actions), [actions]);
}

/** The chips of an empty chat without an article, from the owner's library list. */
export function useLibraryChips() {
  const actions = useLibrarianActions();
  return useMemo(() => libraryChips(actions), [actions]);
}

/** A removed custom action leaves the settings cache stale: refetch it when a run reports that. */
export function useRefreshOnRemovedAction(message: string | undefined) {
  const client = useQueryClient();
  useEffect(() => {
    if (message && /\bunknown_action\b/.test(message))
      void client.invalidateQueries({ queryKey: queryKeys.settings() });
  }, [message, client]);
}

export function useLibrarianSuggestions(
  chatId: string | null,
  message: UIMessage | undefined,
  enabled: boolean,
) {
  const stored = (
    message?.metadata as { suggestions?: { kind: string; text: string }[] } | undefined
  )?.suggestions;
  const query = useQuery({
    queryKey: ['librarian', 'suggestions', chatId, message?.id],
    queryFn: () =>
      apiPost<{ suggestions: { kind: string; text: string }[] } | null>(
        `/api/librarian/chats/${chatId}/messages/${encodeURIComponent(message?.id ?? '')}/suggestions`,
        {},
      ),
    enabled: enabled && !!chatId && stored === undefined,
    // 409: the stream finished before the answer was saved; ask again shortly.
    retry: (count, error) => error instanceof ApiError && error.status === 409 && count < 5,
    retryDelay: 400,
    staleTime: Infinity,
  });
  if (!enabled) return undefined;
  if (stored !== undefined) return { status: 'ready', items: stored };
  if (query.isFetching) return { status: 'pending' };
  return query.isSuccess ? { status: 'ready', items: query.data?.suggestions ?? [] } : undefined;
}
