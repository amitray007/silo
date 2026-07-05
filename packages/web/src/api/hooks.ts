import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiGet, apiPost } from './client';
import type {
  CaptureRequest,
  CaptureResponse,
  Counts,
  LinkJson,
  LinksResponse,
  SearchResponse,
  TagsResponse,
} from './types';

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

/**
 * Builds the placeholder row inserted into the cache the instant `useCaptureLink`
 * fires (before the server has responded) — v3's "saved the moment it lands"
 * (`Silo-v3.html`'s `keep()`: the new row appears with `status: 'enriching'`
 * immediately, filled in later). `id` is a client-generated UUID (`crypto.randomUUID`,
 * available in every browser this SPA targets) — distinct from any server id,
 * so the `onSettled` invalidate/refetch cleanly replaces it (React re-keys by
 * `id`; the placeholder just disappears when the real list lands) rather than
 * colliding with a real row.
 */
function buildOptimisticLink(input: CaptureRequest): LinkJson {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    url: input.url,
    title: null,
    description: null,
    imageUrl: null,
    siteName: null,
    extractedText: null,
    sourceKind: 'link',
    captureStatus: 'enriching',
    addedBy: 'user',
    notes: input.note ?? null,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

/** The shape `useInfiniteLinks`'s cache holds — pages of `LinksResponse`, keyed by `queryKeys.links(filter)`. */
type LinksInfiniteData = InfiniteData<LinksResponse>;

/**
 * Prepends `link` to the FIRST page of every cached `links` infinite-query
 * (every `tag` filter's cache, plus the untagged Library cache) whose scope
 * `link` belongs to — i.e. the untagged cache always, and a tagged cache only
 * when `link.tags` includes that tag. This is what makes the optimistic
 * insert show up in both `LibraryView` and a `TagView` for one of the link's
 * tags without duplicating the splice logic per cache entry.
 */
function insertOptimisticLink(
  queryClient: ReturnType<typeof useQueryClient>,
  link: LinkJson,
): void {
  const matches = queryClient.getQueriesData<LinksInfiniteData>({ queryKey: ['links'] });
  for (const [queryKey, data] of matches) {
    if (!data) continue;
    const filter = (queryKey as [string, { tag?: string; status?: string } | undefined])[1];
    const tag = filter?.tag;
    if (tag && !link.tags.includes(tag)) continue;

    const [firstPage, ...restPages] = data.pages;
    const updatedFirstPage: LinksResponse = {
      ...(firstPage ?? { links: [] }),
      links: [link, ...(firstPage?.links ?? [])],
    };
    queryClient.setQueryData<LinksInfiniteData>(queryKey, {
      ...data,
      pages: [updatedFirstPage, ...restPages],
    });
  }
}

/**
 * Removes the placeholder row with `linkId` from every cached `links`
 * infinite-query, wherever it landed — the `onError` rollback for a failed
 * capture. Filters BY ID rather than restoring a pre-mutation snapshot,
 * specifically so two concurrent captures can't clobber each other: if
 * capture A fails while capture B's placeholder is still in the cache (B
 * inserted after A snapshotted), a snapshot-restore would revert the whole
 * cache entry to its pre-A state and silently delete B's row too. Filtering
 * out only `linkId` leaves every other row — including any other in-flight
 * placeholder — untouched.
 */
function removeOptimisticLink(
  queryClient: ReturnType<typeof useQueryClient>,
  linkId: string,
): void {
  const matches = queryClient.getQueriesData<LinksInfiniteData>({ queryKey: ['links'] });
  for (const [queryKey, data] of matches) {
    if (!data) continue;
    const pages = data.pages.map((page) => ({
      ...page,
      links: page.links.filter((l) => l.id !== linkId),
    }));
    queryClient.setQueryData<LinksInfiniteData>(queryKey, { ...data, pages });
  }
}

/**
 * The omnibar's capture mutation (`POST /api/links`, plan 011 V3-3) — the
 * web mutation layer's first `useMutation`. Wraps `apiPost` with v3's
 * "saved the moment it lands" UX via TanStack Query's optimistic-update
 * lifecycle:
 *
 * - `onMutate`: cancels any in-flight `links` queries (so a background
 *   refetch can't clobber the optimistic splice with stale data), then
 *   prepends a placeholder row (`captureStatus: 'enriching'`, a fresh
 *   client-generated id) to the untagged Library cache and to any
 *   tag-scoped cache the capture's `tags` belong to.
 * - `onError`: removes ONLY that placeholder (matched by its own id) from
 *   every cache it was inserted into — NOT a blanket snapshot-restore. Two
 *   concurrent captures each own their own placeholder id, so one failing
 *   and rolling back can never delete the other's still-in-flight (or
 *   already-succeeded) row.
 * - `onSettled` (success OR failure): invalidates `links`/`counts`/`tags` so
 *   the real server state (which may have DEDUP-MERGED into an existing row
 *   instead of creating a new one) reconciles every placeholder away,
 *   regardless of outcome.
 */
export function useCaptureLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CaptureRequest) => apiPost<CaptureResponse>('/api/links', input),
    onMutate: async (input: CaptureRequest) => {
      await queryClient.cancelQueries({ queryKey: ['links'] });
      const optimisticLink = buildOptimisticLink(input);
      insertOptimisticLink(queryClient, optimisticLink);
      return { optimisticLinkId: optimisticLink.id };
    },
    onError: (_error, _input, context) => {
      if (context?.optimisticLinkId) removeOptimisticLink(queryClient, context.optimisticLinkId);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.links() });
      queryClient.invalidateQueries({ queryKey: ['links'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.counts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags() });
    },
  });
}
