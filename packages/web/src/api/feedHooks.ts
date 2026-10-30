import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import { hasEnrichingLink, invalidateLinkQueries, queryKeys } from './hooks';
import type {
  FeedPostsResponse,
  FeedResponse,
  FeedsResponse,
  FeedTab,
  SearchResponse,
  SubscribeFeedRequest,
  SubscribeFeedResponse,
} from './types';

/** Fetch subscriptions and refresh their counts once a minute. */
export function useFeeds() {
  return useQuery({
    queryKey: queryKeys.feeds(),
    queryFn: () => apiGet<FeedsResponse>('/api/feeds'),
    refetchInterval: 60000,
  });
}

/** Fetch one subscription and its counts. */
export function useFeed(id: string) {
  return useQuery({
    queryKey: queryKeys.feed(id),
    queryFn: () => apiGet<FeedResponse>(`/api/feeds/${id}`),
    enabled: Boolean(id),
    refetchInterval: 60000,
  });
}

/** Page feed posts and poll while enrichment is running. */
export function useFeedPosts(id: string, enabled = true, tab: FeedTab = 'inbox') {
  return useInfiniteQuery({
    queryKey: queryKeys.feedPosts(id, tab),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      apiGet<FeedPostsResponse>(
        `/api/feeds/${id}/posts?tab=${tab}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: FeedPostsResponse) => page.nextCursor,
    enabled: enabled && Boolean(id),
    refetchInterval: (query) => (hasEnrichingLink(query.state.data) ? 1500 : 60000),
  });
}

/** Search both Inbox and Archive; an empty query stays disabled. */
export function useSearchFeedPosts(id: string, query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: [...queryKeys.feedPosts(id), 'search', q],
    queryFn: ({ signal }) =>
      apiGet<SearchResponse>(`/api/feeds/${id}/search?q=${encodeURIComponent(q)}`, signal),
    enabled: Boolean(id) && Boolean(q),
  });
}

/** Subscribe and refresh the feed collections. */
export function useSubscribeFeed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SubscribeFeedRequest) =>
      apiPost<SubscribeFeedResponse>('/api/feeds', input),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.feed(result.feed.id), { feed: result.feed });
      void client.invalidateQueries({ queryKey: queryKeys.feeds() });
      void client.invalidateQueries({ queryKey: queryKeys.feedPosts(result.feed.id) });
    },
  });
}

async function refetchFeedPoll(
  client: QueryClient,
  id: string,
  before: string | null | undefined,
  signal: AbortSignal,
) {
  const current = await client.fetchQuery({
    queryKey: queryKeys.feed(id),
    queryFn: () => apiGet<FeedResponse>(`/api/feeds/${id}`, signal),
    staleTime: 0,
  });
  if (!signal.aborted && current.feed.lastPolledAt !== before)
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.feeds() }),
      client.invalidateQueries({ queryKey: queryKeys.feedPosts(id) }),
    ]);
  return current.feed.lastPolledAt;
}

/** Queue a refresh and watch for a completed poll. */
export function useRefreshFeed() {
  const client = useQueryClient();
  const [tracking, setTracking] = useState<{
    id: string;
    before: string | null | undefined;
  } | null>(null);
  const before = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!tracking) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempt = 0;
    const poll = async () => {
      try {
        const lastPolledAt = await refetchFeedPoll(
          client,
          tracking.id,
          tracking.before,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (lastPolledAt !== tracking.before || ++attempt >= 5) {
          setTracking(null);
          return;
        }
        timer = setTimeout(() => void poll(), 2000);
      } catch {
        if (!controller.signal.aborted) setTracking(null);
      }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, tracking]);
  const mutation = useMutation({
    mutationFn: (id: string) => {
      before.current = client.getQueryData<FeedResponse>(queryKeys.feed(id))?.feed.lastPolledAt;
      return apiPost<{ id: string }>(`/api/feeds/${id}/refresh`, {});
    },
    onSuccess: (_result, id) => {
      setTracking({ id, before: before.current });
    },
  });
  return { ...mutation, isRefreshing: mutation.isPending || tracking !== null };
}

/** Remove a subscription from the feed cache. */
export function useUnsubscribeFeed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/api/feeds/${id}`),
    onSuccess: (_result, id) => {
      client.setQueryData<FeedsResponse>(queryKeys.feeds(), (data) =>
        data ? { feeds: data.feeds.filter((feed) => feed.id !== id) } : data,
      );
      client.removeQueries({ queryKey: queryKeys.feed(id) });
      client.removeQueries({ queryKey: queryKeys.feedPosts(id) });
      void client.invalidateQueries({ queryKey: queryKeys.feeds() });
    },
  });
}

/** Archive or return a feed post to Inbox. */
export function useTriageFeedPost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      feedId,
      postId,
      archived,
    }: {
      feedId: string;
      postId: string;
      archived: boolean;
    }) =>
      apiPost<{ id: string; archivedAt: string | null }>(
        `/api/feeds/${feedId}/posts/${postId}/${archived ? 'archive' : 'unarchive'}`,
        {},
      ),
    onSuccess: async (_result, { feedId, postId }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.feedPosts(feedId) }),
        client.invalidateQueries({ queryKey: queryKeys.feeds() }),
        client.invalidateQueries({ queryKey: queryKeys.feed(feedId) }),
        client.invalidateQueries({ queryKey: queryKeys.link(postId) }),
      ]);
    },
  });
}

/** Save a library copy of a feed post. */
export function useSaveFeedPost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ feedId, postId }: { feedId: string; postId: string }) =>
      apiPost<{ id: string; outcome: 'created' | 'existing' | 'revived' }>(
        `/api/feeds/${feedId}/posts/${postId}/save`,
        {},
      ),
    onSuccess: async (_result, { feedId }) => {
      invalidateLinkQueries(client, { counts: true, tags: true });
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.feedPosts(feedId) }),
        client.invalidateQueries({ queryKey: queryKeys.trash() }),
      ]);
    },
  });
}

/** Rename a feed and refresh its sidebar title. */
export function useRenameFeed(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (title: string | null) => apiPatch<FeedResponse>(`/api/feeds/${id}`, { title }),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.feed(id), data);
      void client.invalidateQueries({ queryKey: queryKeys.feeds() });
    },
  });
}
