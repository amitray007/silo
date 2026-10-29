import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  clearTitleReveal,
  getTitleReveal,
  markTitleEdited,
  mountedTitleBaselines,
  registerTitleReveal,
  restoreTitleReveal,
  transferTitleReveal,
} from '../lib/titleReveals';
import { deriveTitleFromUrl } from '../lib/url';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './client';
import type {
  AccessTokensResponse,
  AiProviderKind,
  AiSettingsResponse,
  AiTestResult,
  AppConfig,
  CaptureRequest,
  CaptureResponse,
  Counts,
  CreatedAccessTokenJson,
  EditLinkRequest,
  EmptyTrashResponse,
  FeedPostsResponse,
  FeedResponse,
  FeedsResponse,
  FeedTab,
  FrameHint,
  LinkJson,
  LinkResponse,
  LinksResponse,
  LinkTitlesResponse,
  LiveReaderJson,
  OAuthClientsResponse,
  RestoreResponse,
  SaveAiKeyResponse,
  SavedLinksResponse,
  SearchResponse,
  SettingsMap,
  SubscribeFeedRequest,
  SubscribeFeedResponse,
  TagsResponse,
  TrashLinkJson,
  TrashResponse,
  TrashSearchResponse,
  UpdateSettingsRequest,
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
  feeds: () => ['feeds'] as const,
  feed: (id: string) => ['feed', id] as const,
  feedPosts: (id: string, tab?: FeedTab) =>
    tab ? (['feed-posts', id, tab] as const) : (['feed-posts', id] as const),
  counts: () => ['counts'] as const,
  tags: () => ['tags'] as const,
  /**
   * TanStack hashes keys structurally and does NOT strip an explicit
   * `undefined` field, so `{ tag: 'x', status: undefined }` would hash
   * DIFFERENTLY from `{ tag: 'x' }` — a silent cache miss / duplicate fetch
   * of the same data. Built by OMITTING undefined fields rather than
   * spreading `filter` verbatim; any new filter field must follow the same
   * omit-when-undefined discipline, never `key.field = undefined`.
   */
  links: (filter?: { tag?: string | undefined; status?: string | undefined }) => {
    const key: { tag?: string; status?: string } = {};
    if (filter?.tag !== undefined) key.tag = filter.tag;
    if (filter?.status !== undefined) key.status = filter.status;
    return ['links', key] as const;
  },
  frame: (id: string) => ['frame', id] as const,
  link: (id: string) => ['link', id] as const,
  liveReader: (id: string) => ['live-reader', id] as const,
  refreshReader: (id: string) => ['refresh-reader', id] as const,
  savedLinks: (urls: readonly string[]) => ['saved-links', urls] as const,
  linkTitles: (urls: readonly string[]) => ['link-titles', urls] as const,
  /**
   * `tag` (optional, command-center search plan 024) is folded into the key
   * so a `q`-only search and the SAME `q` scoped to a tag never collide in
   * the cache — `useSearchLinks('react')` and `useSearchLinks('react',
   * 'frontend')` are distinct cache entries.
   */
  search: (q: string, tag?: string) => ['search', q, tag ?? null] as const,
  /**
   * The command palette's tag-only list view (`useLinksByTag`, plan 024) —
   * deliberately its OWN key family, NOT `links({ tag })`. `links({ tag })`
   * is written by `useInfiniteLinks(tag)` as `InfiniteData<LinksResponse>`
   * (`{ pages: [...], pageParams: [...] }`); `useLinksByTag` is a plain
   * `useQuery` that would write a bare `LinksResponse` (`{ links, nextCursor
   * }`) onto that SAME key. TanStack keys one query cache entry per key
   * regardless of which hook/observer type wrote it — whichever of the two
   * resolves last silently overwrites the other's shape. Concretely: open
   * `/tags/react` (mounts `useInfiniteLinks('react')`), then ⌘K a `#react`
   * query (mounts `useLinksByTag('react')` on the SAME key pre-fix) — the
   * plain response clobbers the infinite-query shape, and
   * `useListView.ts`'s `data?.pages.flatMap(...)` throws on the now-missing
   * `pages` field, crashing `TagView`. A distinct key family removes the
   * collision entirely (at the cost of a possible duplicate fetch when both
   * views are open for the same tag — a correct, cheap tradeoff over a
   * shared-cache "optimization" that can crash a screen).
   */
  tagOnlyList: (tag: string) => ['links-tag-only', tag] as const,
  trash: () => ['trash'] as const,
  trashSearch: (q: string) => ['trash-search', q] as const,
  settings: () => ['settings'] as const,
  ai: () => ['ai'] as const,
  accessTokens: () => ['access-tokens'] as const,
  oauthClients: () => ['oauth-clients'] as const,
  appConfig: () => ['app-config'] as const,
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

export function useSavedLinks(urls: readonly string[]) {
  return useQuery({
    queryKey: queryKeys.savedLinks(urls),
    queryFn: () => apiPost<SavedLinksResponse>('/api/links/saved', { urls }),
    enabled: urls.length > 0,
  });
}

/** Real page titles for an article's outbound links, fetched by silo's server. */
export function useLinkTitles(urls: readonly string[], enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.linkTitles(urls),
    queryFn: () => apiPost<LinkTitlesResponse>('/api/links/titles', { urls }),
    enabled: enabled && urls.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/**
 * The formatted Reader for an open link, built live from its page. The server
 * caches it for ten minutes, so the browser keeps it as long. A 404 (no Reader
 * content) or any failure is final for the visit: the caller falls back to the
 * stored text.
 */
export function useLiveReader(linkId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.liveReader(linkId),
    queryFn: ({ signal }) =>
      apiGet<LiveReaderJson>(`/api/links/${encodeURIComponent(linkId)}/reader`, signal),
    enabled,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Manual Reader refresh updates the open Reader without polling. */
export function useRefreshReader(linkId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: queryKeys.refreshReader(linkId),
    mutationFn: () =>
      apiPost<LiveReaderJson>(`/api/links/${encodeURIComponent(linkId)}/reader/refresh`, {}),
    onSuccess: async (reader) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.liveReader(linkId) });
      queryClient.setQueryData(queryKeys.liveReader(linkId), reader);
      queryClient.invalidateQueries({ queryKey: queryKeys.link(linkId) });
    },
  });
}

/** Fetch one link's detail for the open reader. Polls while the link is still enriching. */
export function useLink(id: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.link(id ?? ''),
    queryFn: () => apiGet<LinkResponse>(`/api/links/${encodeURIComponent(id ?? '')}`),
    enabled: Boolean(id) && (options.enabled ?? true),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.link.captureStatus === 'enriching' ? 1500 : false,
  });
}

/** The paginated list cache, shared by query polling and optimistic writes. */
type LinksInfiniteData = InfiniteData<LinksResponse>;

/**
 * `true` when at least one link across every cached page is still
 * `captureStatus === 'enriching'` — the shared predicate behind
 * `useInfiniteLinks`'s `refetchInterval` (plan 014). Takes the raw
 * `InfiniteData<LinksResponse> | undefined` (exactly what TanStack's
 * `query.state.data` hands the function form) rather than a hook result, so
 * it can be unit-tested with a plain object and reused verbatim inside the
 * `refetchInterval` callback below.
 */
function hasEnrichingLink(data: LinksInfiniteData | undefined): boolean {
  return (data?.pages ?? []).some((page) =>
    page.links.some((l) => l.captureStatus === 'enriching'),
  );
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
 *
 * Live enrichment smart polling (plan 014): `refetchInterval` uses the
 * FUNCTION form (`(query) => ...`) specifically so the decision reads
 * `query.state.data` — the freshest cache at the moment TanStack checks
 * whether to schedule the next poll — rather than a value captured at
 * render time, which could go stale between renders. While any cached page
 * holds a `captureStatus === 'enriching'` row, this returns `1500` (ms),
 * making the feed re-fetch every 1.5s so the optimistic/placeholder row
 * picks up the worker's enrichment (title/favicon/sourceData) shortly after
 * it lands — see `useCaptureLink`'s doc comment for why the initial
 * `onSettled` invalidate alone isn't enough (it fires once, immediately,
 * before the worker has finished). The moment every cached row has settled
 * (`full`/`partial`/`bare`), it returns `false` and polling stops — no
 * perpetual background polling once nothing is in flight.
 * `refetchIntervalInBackground` is left at its default (`false`): a
 * backgrounded tab shouldn't keep polling the API. Deliberately NOT applied
 * to `useTrashList` (trashed links don't enrich) or `useSearchLinks` (a
 * transient omnibar view — polling it is a possible follow-up, out of scope
 * here).
 */
export function useInfiniteLinks(tag?: string, options: { enabled?: boolean } = {}) {
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
    refetchInterval: (query) => (hasEnrichingLink(query.state.data) ? 1500 : false),
    // Defaults to enabled (Library/Tag pages always want the feed). The command
    // palette passes `enabled: !isTrashScope` so opening it in TRASH scope
    // doesn't eagerly fetch `/api/links` for a library-recents list it isn't
    // showing (perf: palette-open over-fetch — mirrors `useTrashList`).
    enabled: options.enabled ?? true,
  });
}

/**
 * The command palette's / (formerly the omnibar's) live search (`GET
 * /api/links/search?q=&tag=`) — plan 011, V3-2; `tag` added plan 024
 * (command center). `enabled: q.trim().length > 0` means an empty/blank
 * query never fires a request (mirrors the API's own `q` min-length-1
 * guard — a client-side no-op is cheaper than a request that would just
 * 400) — `tag` alone with no `q` is NOT enough to fire this hook; that case
 * is the palette's tag-only list query instead (`useLinksByTag`), since
 * `GET /api/links/search` always requires `q`. Callers are responsible for
 * debouncing keystrokes and for not calling this when the query looks like
 * a URL (the `keep` capture path, not search) — this hook itself has no
 * opinion on that, it just fetches for whatever `q`/`tag` it's given.
 */
export function useSearchLinks(q: string, tag?: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: queryKeys.search(trimmed, tag),
    queryFn: () => {
      const params = new URLSearchParams({ q: trimmed });
      if (tag) params.set('tag', tag);
      return apiGet<SearchResponse>(`/api/links/search?${params.toString()}`);
    },
    enabled: trimmed.length > 0,
  });
}

/**
 * The command palette's tag-only view (plan 024): the first page of
 * `GET /api/links?tag=`, for when the parsed query is JUST a settled `#tag`
 * with no free text (`GET /api/links/search` always requires `q`, so a
 * tag-only filter has to go through the plain list route instead). A
 * one-shot `useQuery` (not `useInfiniteLinks`'s paginated machinery) — the
 * palette shows a first page of results, not a "load more" affordance, so
 * the simpler non-infinite hook is enough.
 *
 * Keyed on `queryKeys.tagOnlyList(tag)` — its OWN key family, deliberately
 * NOT `queryKeys.links({ tag })` (bugfix, see that key's doc comment):
 * `useInfiniteLinks(tag)` writes `InfiniteData<LinksResponse>` onto
 * `links({ tag })`, and this hook writes a bare `LinksResponse` — sharing
 * that key let whichever hook resolved last silently corrupt the other's
 * cached shape (`TagView` would crash reading `.pages` off a
 * non-infinite-shaped cache entry). A distinct key means opening the
 * palette for a tag that's also open as a `/tags/:name` browse fetches the
 * data twice rather than sharing one cache entry — a correct, cheap
 * tradeoff over a "shared cache" optimization that could crash a screen.
 * Disabled when `tag` is empty/undefined.
 */
export function useLinksByTag(tag: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tagOnlyList(tag ?? ''),
    queryFn: () => apiGet<LinksResponse>(`/api/links?tag=${encodeURIComponent(tag ?? '')}`),
    enabled: Boolean(tag),
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
    sourceData: { kind: 'link' },
    captureStatus: 'enriching',
    addedBy: 'user',
    source: 'web',
    feedId: null,
    notes: input.note ?? null,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

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
    // `source: 'web'` is stamped HERE, centrally, for every capture through
    // this hook — the omnibar is the only caller, but the point is callers
    // never have to remember to pass it (capture-source design spec, U3).
    mutationFn: (input: CaptureRequest) =>
      apiPost<CaptureResponse>('/api/links', { ...input, source: 'web' }),
    onMutate: async (input: CaptureRequest) => {
      await queryClient.cancelQueries({ queryKey: ['links'] });
      const optimisticLink = buildOptimisticLink(input);
      const titles = mountedTitleBaselines();
      const baselineTitle = deriveTitleFromUrl(input.url);
      registerTitleReveal(optimisticLink.id, baselineTitle);
      insertOptimisticLink(queryClient, optimisticLink);
      return { optimisticLinkId: optimisticLink.id, titles, baselineTitle };
    },
    onSuccess: ({ link }, _input, context) => {
      if (!context) return;
      transferTitleReveal(
        context.optimisticLinkId,
        link.id,
        context.titles.get(link.id) ?? context.baselineTitle,
        !mountedTitleBaselines().has(link.id),
      );
    },
    onError: (_error, _input, context) => {
      if (context?.optimisticLinkId) {
        clearTitleReveal(context.optimisticLinkId);
        removeOptimisticLink(queryClient, context.optimisticLinkId);
      }
    },
    onSettled: () => {
      // The ['links'] prefix invalidate below already covers queryKeys.links()
      // (= ['links', {}]) — a separate invalidate on that exact key is redundant.
      queryClient.invalidateQueries({ queryKey: ['links'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.counts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags() });
      queryClient.invalidateQueries({ queryKey: ['saved-links'] });
    },
  });
}

/**
 * The shared "settle" tail for every mutation below that doesn't optimistically
 * touch the cache itself (edit/trash/tag add/tag remove/retry):
 * always invalidates `['links']` (covers every tag-scoped + untagged cache)
 * and `['link']` — a link's own fields always changed. `tags`/`counts` are
 * OPTED IN per mutation via `affects`, rather than blanket-invalidated, since
 * most of these mutations don't touch tag membership or live/trash counts
 * (e.g. editing a title used to also refetch `/api/tags` + `/api/counts` for
 * no reason). Each call site's `affects` argument carries a one-line comment
 * on WHY that set, so it doesn't drift back to blanket invalidation.
 */
function invalidateLinkQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  affects: { tags?: boolean; counts?: boolean } = {},
): void {
  queryClient.invalidateQueries({ queryKey: ['links'] });
  queryClient.invalidateQueries({ queryKey: ['link'] });
  if (affects.counts) {
    queryClient.invalidateQueries({ queryKey: ['saved-links'] });
    queryClient.invalidateQueries({ queryKey: ['feed-posts'] });
  }
  if (affects.tags) queryClient.invalidateQueries({ queryKey: queryKeys.tags() });
  if (affects.counts) queryClient.invalidateQueries({ queryKey: queryKeys.counts() });
}

/**
 * The edit modal's save mutation (`PATCH /api/links/:id`, plan 011 V3-4) —
 * `title`/`description`/`note` are all optional (an empty patch is a valid
 * no-op per `editBodySchema`). No optimistic update: the modal already shows
 * exactly what the user typed while open, so there's nothing to "feel
 * instant" — settling with a plain invalidate keeps this hook simple and
 * correct (no risk of an optimistic edit clobbering a concurrent server-side
 * change).
 */
export function useEditLink(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: EditLinkRequest) => apiPatch<LinkResponse>(`/api/links/${id}`, input),
    onMutate: (input: EditLinkRequest) => {
      if (input.title !== undefined) markTitleEdited(id);
    },
    // An edit only touches this link's own fields (title/description/note) —
    // never tag membership or live/trash counts — so neither tags nor counts
    // need to be invalidated here.
    onSettled: () => invalidateLinkQueries(queryClient),
  });
}

/**
 * The row menu's + edit modal's "move to trash" mutation (`POST
 * /api/links/:id/trash`, plan 011 V3-4) — optimistically removes the row from
 * every cached `links` list so it disappears the instant trash is clicked,
 * per the build brief ("the row disappears (optimistic)"). On failure the
 * row is RE-INSERTED (via `insertOptimisticLink`, the same by-id-scoped
 * splice `useCaptureLink` uses to insert its placeholder) rather than
 * restored from a whole-cache snapshot — a review of this hook flagged that
 * an earlier version snapshotted every matching `['links']` query in
 * `onMutate` and restored the WHOLE snapshot verbatim in `onError`, which
 * would silently clobber any OTHER mutation that had written to the same
 * cache entries in between (e.g. a tag add/remove on this same link, fired
 * from the same open `EditModal`, settling while the trash POST is still in
 * flight and then failing) — exactly the class of bug `useCaptureLink`'s own
 * doc comment already reasons about avoiding for concurrent captures.
 * Re-inserting just this one link by id, using whatever its row data looked
 * like right before removal, leaves every other row (and any of ITS
 * in-flight edits) untouched.
 *
 * The link id is the mutation VARIABLE, not a hook argument (also true of
 * `useRestoreLink` and `useDeleteNow`): TanStack updates a pending mutation's
 * options on re-render, so an id captured by the hook would retarget
 * `onMutate`/`onError` at a newly selected link mid-flight.
 */
export function useTrashLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiPost<LinkResponse>(`/api/links/${id}/trash`, {}),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['links'] });
      const matches = queryClient.getQueriesData<LinksInfiniteData>({ queryKey: ['links'] });
      const removedLink = matches
        .flatMap(([, data]) => data?.pages.flatMap((page) => page.links) ?? [])
        .find((l) => l.id === id);
      removeOptimisticLink(queryClient, id);
      return { removedLink };
    },
    onError: (_error, _vars, context) => {
      if (context?.removedLink) insertOptimisticLink(queryClient, context.removedLink);
    },
    // A link moving to trash drops the live count AND every tag it carried
    // drops a per-tag count — both need refetching, unlike a plain edit.
    onSettled: () => invalidateLinkQueries(queryClient, { tags: true, counts: true }),
  });
}

/**
 * The row menu's tags fly-out "add" mutation (`POST /api/links/:id/tags`,
 * plan 011 V3-4). Plain invalidate on settle — tag membership across the
 * sidebar's per-tag counts, the tag-scoped list caches, and this link's own
 * row is enough surface area that an optimistic patch would have to touch all
 * three; a fast invalidate is simpler and still feels immediate against a
 * local API.
 */
export function useAddTag(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tag: string) => apiPost<LinkResponse>(`/api/links/${id}/tags`, { tag }),
    // Adding a tag changes that tag's per-tag count (sidebar) but not the
    // live/trash counts — invalidate tags, not counts.
    onSettled: () => invalidateLinkQueries(queryClient, { tags: true }),
  });
}

/** The row menu's tags fly-out "remove" mutation (`DELETE /api/links/:id/tags/:tag`) — mirrors `useAddTag`'s invalidate-only settle. */
export function useRemoveTag(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tag: string) =>
      apiDelete<LinkResponse>(`/api/links/${id}/tags/${encodeURIComponent(tag)}`),
    // Removing a tag changes that tag's per-tag count the same way adding
    // one does — invalidate tags, not counts.
    onSettled: () => invalidateLinkQueries(queryClient, { tags: true }),
  });
}

/**
 * The tags fly-out's "+ create" mutation (`POST /api/tags`) — standalone tag
 * creation (not yet assigned to any link; the caller assigns it via
 * `useAddTag` right after, matching v3's `createEfTagFn`/menu "create" flow).
 * Invalidates `tags` on settle so the fly-out's option list picks up the new
 * tag immediately.
 */
export function useCreateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => apiPost<{ name: string }>('/api/tags', { name }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tags() });
    },
  });
}

/**
 * Delete a tag from the ENTIRE library (`DELETE /api/tags/:name`) — removes
 * the tag and unlinks it from every link, keeping the links. Mirrors
 * `useCreateTag` but invalidates more: a deleted tag vanishes from the
 * sidebar tag list (`tags`), changes the tag set of every affected link
 * (`links` / `links-tag-only`), and shifts counts. Distinct from
 * `useRemoveTag`, which detaches a tag from one link.
 */
export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiDelete<{ deleted: boolean }>(`/api/tags/${encodeURIComponent(name)}`),
    onSettled: () => {
      invalidateLinkQueries(queryClient, { tags: true, counts: true });
      queryClient.invalidateQueries({ queryKey: ['links-tag-only'] });
    },
  });
}

/**
 * The Trash screen's feed (`GET /api/trash`, plan 011 V3-5). Unlike
 * `useInfiniteLinks`, this is a plain (non-paginated) query — the Trash
 * screen's build brief doesn't call for "load more" chrome, and v3's mock
 * data has no trash pagination UI either; a later slice can upgrade this to
 * `useInfiniteQuery` if the trash list grows large enough to need it, without
 * changing this hook's call sites (same query key family, `['trash', ...]`).
 */
export function useTrashList(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.trash(),
    queryFn: () => apiGet<TrashResponse>('/api/trash'),
    // Defaults to enabled (the `/trash` page always wants it). The command
    // palette passes `enabled: isTrashScope` so opening the palette on a
    // NON-trash page doesn't eagerly fetch `/api/trash` for a trash-recents
    // list it isn't even showing yet (perf: palette-open over-fetch).
    enabled: options.enabled ?? true,
  });
}

/**
 * The command palette's trash-scoped server search (`GET /api/trash/search?q=`,
 * Trash search slice) — mirrors `useSearchLinks` exactly (same `enabled:
 * trimmed.length > 0` no-op-on-empty guard, same trim-before-key discipline
 * so whitespace-only queries don't fire), hitting the trash-scoped route
 * instead. The palette (`CommandPalette.tsx`) is the sole caller since the
 * Trash view's own inline search box was removed — when the palette opens on
 * the Trash page it scopes to this endpoint (`usePaletteScope`). Callers
 * debounce keystrokes, same as `useSearchLinks`'s callers.
 */
export function useSearchTrash(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: queryKeys.trashSearch(trimmed),
    queryFn: () =>
      apiGet<TrashSearchResponse>(`/api/trash/search?q=${encodeURIComponent(trimmed)}`),
    enabled: trimmed.length > 0,
  });
}

/**
 * Removes `id` from every cached `trash` query's `links` array — the shared
 * optimistic-removal tail for `useRestoreLink`/`useDeleteNow`. Mirrors
 * `removeOptimisticLink`'s by-id approach for the same reason: two concurrent
 * restore/delete calls on different rows must not be able to clobber each
 * other's optimistic state.
 */
function removeFromTrashCache(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
): TrashLinkJson | undefined {
  const matches = queryClient.getQueriesData<TrashResponse>({ queryKey: queryKeys.trash() });
  let removed: TrashLinkJson | undefined;
  for (const [queryKey, data] of matches) {
    if (!data) continue;
    const found = data.links.find((l) => l.id === id);
    if (found) removed = found;
    queryClient.setQueryData<TrashResponse>(queryKey, {
      ...data,
      links: data.links.filter((l) => l.id !== id),
    });
  }
  return removed;
}

/** Re-inserts `link` at the front of every cached `trash` query — the `onError` rollback for `removeFromTrashCache`, mirroring `insertOptimisticLink`'s by-id re-insert. */
function insertIntoTrashCache(
  queryClient: ReturnType<typeof useQueryClient>,
  link: TrashLinkJson,
): void {
  const matches = queryClient.getQueriesData<TrashResponse>({ queryKey: queryKeys.trash() });
  for (const [queryKey, data] of matches) {
    if (!data) continue;
    queryClient.setQueryData<TrashResponse>(queryKey, {
      ...data,
      links: [link, ...data.links],
    });
  }
}

/** The shared settle tail for every trash-lifecycle mutation below: the trash list itself, plus `counts` (live/trash tallies) — trash mutations never touch tag counts. */
function invalidateTrashQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['feed-posts'] });
  queryClient.invalidateQueries({ queryKey: ['link'] });
  queryClient.invalidateQueries({ queryKey: ['saved-links'] });
  queryClient.invalidateQueries({ queryKey: queryKeys.trash() });
  queryClient.invalidateQueries({ queryKey: queryKeys.counts() });
}

/**
 * The trash row's "restore" mutation (`POST /api/links/:id/restore`, plan 011
 * V3-5) — optimistically removes the row from the trash cache the instant
 * restore is clicked (it's about to reappear in the Library instead).
 * `onSettled` invalidates BOTH `trash` and `links`/`counts` — restoring
 * un-trashes a link, so the Library feed needs to pick it up too, not just
 * the trash list losing it. On failure the row is re-inserted (by id, not a
 * whole-cache snapshot — same rationale as `useTrashLink`'s doc comment).
 */
export function useRestoreLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiPost<RestoreResponse>(`/api/links/${id}/restore`, {}),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.trash() });
      const removedLink = removeFromTrashCache(queryClient, id);
      return { removedLink };
    },
    onError: (_error, _vars, context) => {
      if (context?.removedLink) insertIntoTrashCache(queryClient, context.removedLink);
    },
    onSettled: () => {
      invalidateTrashQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['links'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags() });
    },
  });
}

/**
 * The trash row's "delete now" mutation (`DELETE /api/trash/:id`, plan 011
 * V3-5) — a hard, irreversible delete; matching v3, there is no confirm
 * dialog. Optimistically removes the row from the trash cache; on failure
 * it's re-inserted (the delete never actually happened server-side).
 */
export function useDeleteNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/api/trash/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.trash() });
      const removedLink = removeFromTrashCache(queryClient, id);
      return { removedLink };
    },
    onError: (_error, _vars, context) => {
      if (context?.removedLink) insertIntoTrashCache(queryClient, context.removedLink);
    },
    onSettled: () => invalidateTrashQueries(queryClient),
  });
}

/**
 * The Trash header's "Empty trash" mutation (`DELETE /api/trash`, plan 011 V3-5)
 * — matching v3's `emptyNow` (no confirm). No optimistic clear: the whole
 * trash list is about to disappear regardless of a race with anything else
 * touching it, so a plain invalidate-on-settle is simplest and correct here
 * (unlike a single-row removal, there's no "other row" an optimistic update
 * could protect).
 */
export function useEmptyTrash() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiDelete<EmptyTrashResponse>('/api/trash'),
    onSettled: () => invalidateTrashQueries(queryClient),
  });
}

/**
 * The row menu's / edit modal's "retry capture" mutation (`POST
 * /api/links/:id/retry`) — surfaced here per the build brief's optional
 * degraded-retry affordance. Plain invalidate-on-settle: a retry resets
 * `captureStatus` back to `enriching` server-side, and the enriching
 * indicator/mark already re-renders correctly off a fresh `links` fetch, so
 * there's nothing worth optimistically patching.
 */
export function useRetryCapture(id: string, baselineTitle?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiPost<LinkResponse>(`/api/links/${id}/retry`, {}),
    onMutate: () => {
      const previous = getTitleReveal(id);
      const pending = registerTitleReveal(id, baselineTitle ?? mountedTitleBaselines().get(id));
      return { previous, pending };
    },
    onError: (_error, _input, context) => {
      if (context) restoreTitleReveal(id, context.pending, context.previous);
    },
    // A retry only resets this link's own captureStatus — never tag
    // membership or live/trash counts.
    onSettled: () => invalidateLinkQueries(queryClient),
  });
}

/**
 * The Settings modal's read (`GET /api/settings`, plan 016) — hydrates the
 * theme picker, the 7/30/90 trash-purge-cycle picker, and the plugin
 * toggles. `useSettings().data` is `SettingsMap | undefined` until loaded;
 * the API itself never omits a key (every unset key falls back to its
 * server-side default — see `core.getAllSettings`'s doc comment), so once
 * loaded every field is always present.
 */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => apiGet<SettingsMap>('/api/settings'),
  });
}

/**
 * The Settings modal's write (`PATCH /api/settings`, plan 016) — every field
 * of `UpdateSettingsRequest` is optional, so a caller patches just the one
 * control the user touched (e.g. `{ theme: 'dark' }`).
 *
 * OPTIMISTIC (plan 026 review fix — ce-adversarial/ce-correctness): the
 * plugins toggles do a full-object READ-MODIFY-WRITE (`setPluginField` rebuilds
 * the whole `plugins` map from the current `useSettings()` snapshot, since the
 * store replaces the whole value with no sub-key merge). Without an
 * `onMutate` optimistic cache write, two quick toggles both read the SAME
 * stale snapshot — the second PATCH is built without the first's change and
 * clobbers it (last-write-wins), silently losing a toggle the user clicked.
 * `onMutate` merges the patch into the cached map IMMEDIATELY (before the
 * round-trip), so a rapid follow-up `writeField` reads the updated value and
 * its PATCH carries BOTH changes. Standard optimistic pattern: cancel
 * in-flight refetches, snapshot for rollback, roll back `onError`. `onSuccess`
 * still writes the server's authoritative full map; `onSettled` invalidates as
 * a cross-tab safety net.
 *
 * The merge is shallow-at-the-top (`{ ...prev, ...patch }`) — correct because
 * every caller sends a COMPLETE top-level value for each key it touches
 * (`setPluginField` returns the full three-source `plugins` object; theme /
 * trashPurgeDays are scalars), so a partial nested object never reaches here.
 */
export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: UpdateSettingsRequest) => apiPatch<SettingsMap>('/api/settings', patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings() });
      const previous = queryClient.getQueryData<SettingsMap>(queryKeys.settings());
      // Only optimistically merge when we already have a loaded snapshot — a
      // partial merge onto `undefined` would produce an incomplete map. If
      // settings haven't loaded yet the callers (PluginsTab) gate their
      // controls on `loading`, so no write originates from that window.
      if (previous) {
        queryClient.setQueryData<SettingsMap>(queryKeys.settings(), { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.settings(), context.previous);
      }
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings(), settings);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
      // AI readiness (enabled, provider, resolved model) derives from these settings.
      queryClient.invalidateQueries({ queryKey: queryKeys.ai() });
    },
  });
}

/** `GET /api/ai`: readiness, provider rows (last four characters only), stored model lists. */
export function useAi() {
  return useQuery({
    queryKey: queryKeys.ai(),
    queryFn: () => apiGet<AiSettingsResponse>('/api/ai'),
  });
}

/** Operator-only refresh; the server stores the live list before responding. */
export function useRefreshAiModels(kind: AiProviderKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost(`/api/ai/providers/${kind}/models/refresh`, {}),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ai() });
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
    },
  });
}

/**
 * `PUT /api/ai/providers/:kind`. The typed key lives only in mutation variables,
 * so the cache entry is dropped at once (`gcTime: 0`) and callers `reset()` it.
 */
export function useSaveAiKey(kind: AiProviderKind) {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (apiKey: string) =>
      apiPut<SaveAiKeyResponse>(`/api/ai/providers/${kind}`, { apiKey }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ai() });
      if (kind === 'fireworks') {
        queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
      }
    },
  });
}

/** `POST /api/ai/providers/:kind/test`. */
export function useTestAiKey(kind: AiProviderKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<AiTestResult>(`/api/ai/providers/${kind}/test`, {}),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ai() });
      if (kind === 'fireworks') {
        queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
      }
    },
  });
}

/** `DELETE /api/ai/providers/:kind`. Settings can change too (the provider may fall back). */
export function useRemoveAiKey(kind: AiProviderKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete<void>(`/api/ai/providers/${kind}`),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ai() });
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
    },
  });
}

/**
 * The Access tab's token list (`GET /api/access-tokens`, U4) — unwraps the
 * `{ tokens }` envelope the same way `useTags` unwraps `{ tags }`, so
 * `useAccessTokens().data` is `AccessTokenJson[] | undefined` directly (never
 * the raw token — that only ever appears once, on `useCreateAccessToken`'s
 * mutation result).
 */
export function useAccessTokens() {
  return useQuery({
    queryKey: queryKeys.accessTokens(),
    queryFn: async () => (await apiGet<AccessTokensResponse>('/api/access-tokens')).tokens,
  });
}

/**
 * The Access tab's "New token" mutation (`POST /api/access-tokens`, U4) —
 * returns the full `CreatedAccessTokenJson` (name/prefix/dates PLUS the raw
 * `token`, present this one time) so the caller can show it once in a
 * copyable reveal field. No optimistic insert: the list needs the server's
 * real `id`/`prefix`/`createdAt` to render a correct row, so `onSuccess`
 * simply invalidates the list to pick up the new row (the raw-token reveal
 * itself is driven by the mutation's own returned data, not by anything
 * read back out of the list).
 */
export function useCreateAccessToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string }) =>
      apiPost<CreatedAccessTokenJson>('/api/access-tokens', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accessTokens() });
    },
  });
}

/**
 * The Access tab's "Revoke" mutation (`DELETE /api/access-tokens/:id`, U4) —
 * plain invalidate-on-success (no optimistic removal): a revoke is a
 * deliberate, confirmed action off a short list, not a hot path worth the
 * extra rollback-on-failure complexity `useTrashLink`/`useDeleteNow` carry
 * for their higher-frequency, higher-volume lists.
 */
export function useRevokeAccessToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/api/access-tokens/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accessTokens() });
    },
  });
}

/**
 * The Access tab's connected-apps list (`GET /api/access-tokens/
 * oauth-clients`, MCP OAuth Unit 4) — unwraps the `{ clients }` envelope the
 * same way `useAccessTokens` unwraps `{ tokens }`, so
 * `useOAuthClients().data` is `ConnectedOAuthClient[] | undefined` directly.
 * Each entry is already deduped-by-name server-side (`listOAuthClientsForOwner`,
 * `@silo/core`); this hook does no client-side grouping of its own.
 */
export function useOAuthClients() {
  return useQuery({
    queryKey: queryKeys.oauthClients(),
    queryFn: async () =>
      (await apiGet<OAuthClientsResponse>('/api/access-tokens/oauth-clients')).clients,
  });
}

/**
 * The connected-apps list's "Revoke" mutation for ONE `cli_` client id
 * (`DELETE /api/access-tokens/oauth-clients/:clientId`, MCP OAuth Unit 4).
 * Revoking a deduped GROUP means calling this once per id in the group's
 * `clientIds[]` — callers fan out via `Promise.all` rather than
 * this hook looping internally. Plain invalidate-on-success,
 * same posture as `useRevokeAccessToken` (a deliberate, confirmed action off
 * a short list — not a hot path worth optimistic rollback complexity).
 */
export function useRevokeOAuthClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (clientId: string) =>
      apiDelete<void>(`/api/access-tokens/oauth-clients/${clientId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.oauthClients() });
    },
  });
}

/**
 * The connected-apps section's "Revoke all" mutation (`DELETE
 * /api/access-tokens/oauth-clients`, MCP OAuth Unit 4) — the collection-level
 * revoke, distinct from fanning out `useRevokeOAuthClient` over every group's
 * `clientIds` (this hits one endpoint that clears every OAuth client in a
 * single request).
 */
export function useRevokeAllOAuthClients() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiDelete<void>('/api/access-tokens/oauth-clients'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.oauthClients() });
    },
  });
}

/**
 * The Access tab's public deploy-config read (`GET /api/config`,
 * deployable-silo slice Unit 4) — feeds `resolveMcpUrl`
 * (`packages/web/src/lib/mcpUrl.ts`) step 1 of its precedence: an
 * operator-set `SILO_PUBLIC_MCP_URL` wins verbatim over the client-derived
 * `mcp.<hostname>` guess. Ungated on the server (`registerConfigRoutes`), so
 * this hook is safe to call even before login resolves — same posture as
 * `AuthContext`'s own `/api/auth/check` read. `useAppConfig().data` is
 * `AppConfig | undefined` until loaded; `mcpUrl` itself is optional even once
 * loaded (present only when the operator configured it).
 */
export function useAppConfig() {
  return useQuery({
    queryKey: queryKeys.appConfig(),
    queryFn: () => apiGet<AppConfig>('/api/config'),
  });
}

/** Fetch only on Original, after player detection. Abort when the reader closes. */
export function useFrameHint(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.frame(id),
    queryFn: ({ signal }) =>
      apiGet<FrameHint>(`/api/links/${encodeURIComponent(id)}/frame`, signal),
    enabled,
    retry: false,
    staleTime: 0,
  });
}

export function useFeeds() {
  return useQuery({
    queryKey: queryKeys.feeds(),
    queryFn: () => apiGet<FeedsResponse>('/api/feeds'),
    refetchInterval: 60000,
  });
}
export function useFeed(id: string) {
  return useQuery({
    queryKey: queryKeys.feed(id),
    queryFn: () => apiGet<FeedResponse>(`/api/feeds/${id}`),
    enabled: Boolean(id),
    refetchInterval: 60000,
  });
}
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

export function useRefreshFeed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const before = client.getQueryData<FeedResponse>(queryKeys.feed(id))?.feed.lastPolledAt;
      const result = await apiPost<{ id: string }>(`/api/feeds/${id}/refresh`, {});
      // The response accepts a job; it does not mean the worker has polled yet.
      // A failed check only stops the wait: the refresh itself was accepted.
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const current = await client.fetchQuery({
            queryKey: queryKeys.feed(id),
            queryFn: () => apiGet<FeedResponse>(`/api/feeds/${id}`),
            staleTime: 0,
          });
          await Promise.all([
            client.invalidateQueries({ queryKey: queryKeys.feeds() }),
            client.invalidateQueries({ queryKey: queryKeys.feedPosts(id) }),
          ]);
          if (current.feed.lastPolledAt !== before) break;
        }
      } catch {
        // Stop waiting; the next scheduled refetch shows the result.
      }
      return result;
    },
  });
}

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
