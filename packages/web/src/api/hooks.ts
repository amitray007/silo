import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiGet } from './client';
import type { Counts, LinksResponse, TagsResponse } from './types';

/**
 * Query keys as a plain object of key-builders (not raw string arrays
 * scattered per call site) so a later slice's invalidation
 * (`queryClient.invalidateQueries({ queryKey: queryKeys.counts() })` after a
 * capture/trash/restore mutation) can't drift from what the read hooks below
 * actually use. `links`/`link` are declared now even though W4 has no hook
 * using them yet — the list/search/single-link hooks land in later slices
 * (plan 008 W4 scope note) and will key off these same builders.
 */
export const queryKeys = {
  counts: () => ['counts'] as const,
  tags: () => ['tags'] as const,
  links: (filter?: { tag?: string; status?: string }) => ['links', filter ?? {}] as const,
  link: (id: string) => ['link', id] as const,
};

/** The sidebar's live/trash counts (`GET /api/counts`) — `useCounts().data` is `Counts | undefined` until loaded. */
export function useCounts() {
  return useQuery({
    queryKey: queryKeys.counts(),
    queryFn: () => apiGet<Counts>('/api/counts'),
  });
}

/** The sidebar's tag list with per-tag counts (`GET /api/tags`) — `useTags().data` is `TagsResponse | undefined` until loaded. */
export function useTags() {
  return useQuery({
    queryKey: queryKeys.tags(),
    queryFn: () => apiGet<TagsResponse>('/api/tags'),
  });
}

/**
 * The Library list's cursor-paginated feed (`GET /api/links`, no tag filter —
 * plan 010). `pageParam` is the previous page's opaque `nextCursor`, passed
 * back verbatim as `?cursor=` (URL-encoded — it's an opaque token, not
 * necessarily URL-safe); `getNextPageParam` reads the next page's cursor off
 * the last-fetched page, so `hasNextPage` flips to `false` the moment a page
 * comes back without one. Callers flatten `data.pages.flatMap(p => p.links)`
 * before rendering.
 */
export function useInfiniteLinks() {
  return useInfiniteQuery({
    queryKey: queryKeys.links(),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      apiGet<LinksResponse>(
        `/api/links${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: LinksResponse) => lastPage.nextCursor,
  });
}
