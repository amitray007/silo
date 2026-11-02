import type { UIMessage } from '@ai-sdk/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiUrl } from './client';

export type ChatSummary = {
  id: string;
  title: string;
  linkId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ChatPage = { chats: ChatSummary[]; nextCursor: string | null };
const CHAT_PAGE_SIZE = 20;
export type ChatDetail = { chat: ChatSummary; messages: UIMessage[] };
export const librarianApi = {
  list: (linkId: string, limit = 1, cursor?: string) =>
    apiGet<ChatPage>(
      `/api/librarian/chats?${new URLSearchParams({ linkId, limit: String(limit), ...(cursor ? { cursor } : {}) })}`,
    ),
  create: (linkId: string) => apiPost<ChatSummary>('/api/librarian/chats', { linkId }),
  get: (id: string) => apiGet<ChatDetail>(`/api/librarian/chats/${id}`),
  delete: (id: string) => apiDelete(`/api/librarian/chats/${id}`),
  messagesUrl: (id: string) => apiUrl(`/api/librarian/chats/${id}/messages`),
};
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
    onSuccess: () => client.invalidateQueries({ queryKey: ['librarian', 'list'] }),
  });
}

export function useImportLibrarianTurn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ linkId, messages }: { linkId: string; messages: UIMessage[] }) => {
      const list = await librarianApi.list(linkId);
      const chat = list.chats[0] ?? (await librarianApi.create(linkId));
      await apiPost(`/api/librarian/chats/${chat.id}/import`, { messages });
      return chat.id;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['librarian'] }),
  });
}
