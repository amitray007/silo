import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type {
  CaptureRequest,
  CaptureResponse,
  Counts,
  EditLinkRequest,
  EmptyTrashResponse,
  LinkJson,
  LinkResponse,
  LinksResponse,
  RestoreResponse,
  SearchResponse,
  TagsResponse,
  TrashLinkJson,
  TrashResponse,
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
  trash: () => ['trash'] as const,
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

/**
 * The shared "settle" tail for every mutation below that doesn't optimistically
 * touch the cache itself (edit/tag add/tag remove/create-tag): invalidate the
 * broad `['links']` family (covers every tag-scoped + untagged cache),
 * `counts`, and `tags` so the server's reconciled state (new tag counts, edited
 * title/description, etc.) reliably replaces whatever was showing. A plain
 * invalidate is deliberately simpler than an optimistic patch here — these
 * mutations touch fields (`tags`, `title`, `description`, `note`) that don't
 * need to feel instantaneous the way capture/trash do, per the build brief.
 */
function invalidateLinkQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['links'] });
  queryClient.invalidateQueries({ queryKey: ['link'] });
  queryClient.invalidateQueries({ queryKey: queryKeys.counts() });
  queryClient.invalidateQueries({ queryKey: queryKeys.tags() });
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
 */
export function useTrashLink(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiPost<LinkResponse>(`/api/links/${id}/trash`, {}),
    onMutate: async () => {
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
    onSettled: () => invalidateLinkQueries(queryClient),
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
    onSettled: () => invalidateLinkQueries(queryClient),
  });
}

/** The row menu's tags fly-out "remove" mutation (`DELETE /api/links/:id/tags/:tag`) — mirrors `useAddTag`'s invalidate-only settle. */
export function useRemoveTag(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tag: string) =>
      apiDelete<LinkResponse>(`/api/links/${id}/tags/${encodeURIComponent(tag)}`),
    onSettled: () => invalidateLinkQueries(queryClient),
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
 * The Trash screen's feed (`GET /api/trash`, plan 011 V3-5). Unlike
 * `useInfiniteLinks`, this is a plain (non-paginated) query — the Trash
 * screen's build brief doesn't call for "load more" chrome, and v3's mock
 * data has no trash pagination UI either; a later slice can upgrade this to
 * `useInfiniteQuery` if the trash list grows large enough to need it, without
 * changing this hook's call sites (same query key family, `['trash', ...]`).
 */
export function useTrashList() {
  return useQuery({
    queryKey: queryKeys.trash(),
    queryFn: () => apiGet<TrashResponse>('/api/trash'),
  });
}

/**
 * Removes `id` from every cached `trash` query's `links` array — the shared
 * optimistic-removal tail for `useRestoreLink`/`useDeleteNow`/the bulk trash
 * mutations below. Mirrors `removeOptimisticLink`'s by-id (not
 * whole-snapshot) approach for the same reason: two concurrent
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
export function useRestoreLink(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiPost<RestoreResponse>(`/api/links/${id}/restore`, {}),
    onMutate: async () => {
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
export function useDeleteNow(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiDelete<void>(`/api/trash/${id}`),
    onMutate: async () => {
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
 * The trash dock's "empty all" mutation (`DELETE /api/trash`, plan 011 V3-5)
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
export function useRetryCapture(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiPost<LinkResponse>(`/api/links/${id}/retry`, {}),
    onSettled: () => invalidateLinkQueries(queryClient),
  });
}

/**
 * Fires `mutationFn` for every id in `ids` concurrently (`Promise.allSettled`
 * — a partial failure never aborts the others) and returns which ids
 * succeeded/failed. Shared by every bulk op below (bulk-trash from the
 * Library selection dock, bulk-restore/bulk-delete-now from the Trash
 * selection dock) so "loop the single-item endpoint, tolerate partial
 * failure" has exactly one implementation rather than four near-identical
 * copies (jscpd guards production src at 1.5%).
 */
export async function runBulk(
  ids: string[],
  mutationFn: (id: string) => Promise<unknown>,
): Promise<{ succeeded: string[]; failed: string[] }> {
  const results = await Promise.allSettled(ids.map((id) => mutationFn(id)));
  const succeeded: string[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => {
    const id = ids[i];
    if (id === undefined) return;
    (result.status === 'fulfilled' ? succeeded : failed).push(id);
  });
  return { succeeded, failed };
}

/**
 * The Library selection dock's "move to trash" bulk op (plan 011, V3-5) — no
 * bulk API exists, so this loops `POST /api/links/:id/trash` per id via
 * `runBulk` (concurrent, partial-failure-tolerant) and invalidates once at
 * the end rather than once per row (avoids N redundant refetches for an
 * N-item selection). Returns the same `{ succeeded, failed }` shape as
 * `runBulk` so the calling dock can report "3 of 5 moved to trash" on a
 * partial failure instead of failing silently.
 */
export function useBulkTrash() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => runBulk(ids, (id) => apiPost(`/api/links/${id}/trash`, {})),
    onSettled: () => {
      invalidateLinkQueries(queryClient);
      invalidateTrashQueries(queryClient);
    },
  });
}

/** The Trash selection dock's "restore" bulk op — loops `POST /api/links/:id/restore` via `runBulk`; see `useBulkTrash`'s doc comment for the shared shape/rationale. */
export function useBulkRestore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => runBulk(ids, (id) => apiPost(`/api/links/${id}/restore`, {})),
    onSettled: () => {
      invalidateTrashQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['links'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags() });
    },
  });
}

/** The Trash selection dock's "delete now" bulk op — loops `DELETE /api/trash/:id` via `runBulk`; see `useBulkTrash`'s doc comment for the shared shape/rationale. */
export function useBulkDeleteNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => runBulk(ids, (id) => apiDelete(`/api/trash/${id}`)),
    onSettled: () => invalidateTrashQueries(queryClient),
  });
}
