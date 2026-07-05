import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiGet } from './client';
import type { Counts, LinksResponse, SearchResponse, TagsResponse } from './types';

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
  search: (q: string) => ['search', q] as const,
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
 * The Library/tag list's cursor-paginated feed (`GET /api/links[?tag=]`).
 * `tag` (added plan 011, V3-2) scopes the feed to `/tags/:name` — omitted,
 * this is the plain Library feed (plan 010). `pageParam` is the previous
 * page's opaque `nextCursor`, passed back verbatim as `?cursor=`
 * (URL-encoded — it's an opaque token, not necessarily URL-safe);
 * `getNextPageParam` reads the next page's cursor off the last-fetched page,
 * so `hasNextPage` flips to `false` the moment a page comes back without one.
 * Callers flatten `data.pages.flatMap(p => p.links)` before rendering.
 */
export function useInfiniteLinks(tag?: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.links(tag ? { tag } : undefined),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams();
      if (tag) params.set('tag', tag);
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return apiGet<LinksResponse>(`/api/links${qs ? `?${qs}` : ''}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: LinksResponse) => lastPage.nextCursor,
  });
}

/**
 * The omnibar's live search (`GET /api/links/search?q=`) — plan 011, V3-2.
 * `enabled: q.trim().length > 0` means an empty/blank query never fires a
 * request (mirrors the API's own `q` min-length-1 guard — a client-side
 * no-op is cheaper than a request that would just 400). Callers are
 * responsible for debouncing keystrokes (`Omnibar.tsx`) and for not calling
 * this when the query looks like a URL (the `keep` capture path, not
 * search) — this hook itself has no opinion on that, it just fetches for
 * whatever `q` it's given.
 */
export function useSearchLinks(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: queryKeys.search(trimmed),
    queryFn: () => apiGet<SearchResponse>(`/api/links/search?q=${encodeURIComponent(trimmed)}`),
    enabled: trimmed.length > 0,
  });
}
