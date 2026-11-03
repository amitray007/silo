import type { UIMessage } from '@ai-sdk/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiUrl } from './client';

export type ChatSummary = {
  id: string;
  title: string;
  linkId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ChatDetail = { chat: ChatSummary; messages: UIMessage[] };
export const librarianApi = {
  list: (linkId: string, limit = 1) =>
    apiGet<{ chats: ChatSummary[]; nextCursor: string | null }>(
      `/api/librarian/chats?${new URLSearchParams({ linkId, limit: String(limit) })}`,
    ),
  create: (linkId: string) => apiPost<ChatSummary>('/api/librarian/chats', { linkId }),
  get: (id: string) => apiGet<ChatDetail>(`/api/librarian/chats/${id}`),
  delete: (id: string) => apiDelete(`/api/librarian/chats/${id}`),
  messagesUrl: (id: string) => apiUrl(`/api/librarian/chats/${id}/messages`),
};
export function useLibrarianChats(linkId: string) {
  return useQuery({
    queryKey: ['librarian', 'list', linkId],
    queryFn: () => librarianApi.list(linkId),
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
