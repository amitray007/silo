import type { ApiError } from '../../api/client';
import { useCaptureLink, useCounts, useInfiniteLinks, useSearchLinks } from '../../api/hooks';
import type { LinkJson, SearchResultJson } from '../../api/types';
import { useOmnibarState } from '../../lib/useOmnibarState';

/**
 * The shared list-view orchestration behind `LibraryView` (`/`) and `TagView`
 * (`/tags/:name`) — plan 011, V3-2. Both screens are the same day-grouped feed
 * with the omnibar's live search on top; the only differences are the optional
 * `tag` scope on the browse feed and each view's title / empty-state / tag-pill
 * chrome (which the route components supply). This hook owns everything else so
 * that orchestration isn't duplicated across the two routes.
 *
 * Search is global in both views (matching v3 — the `/api/links/search` `q`
 * param has no `tag` filter yet), so `results` is the same regardless of `tag`;
 * `tag` only scopes the non-search `links` feed.
 */
export interface ListViewState {
  omnibar: ReturnType<typeof useOmnibarState>;
  /** Live library count (from `/api/counts`) — the omnibar's "of N" + header count fallback. */
  liveCount: number | undefined;
  /** The browse feed (day-grouped, paginated), scoped to `tag` when given. */
  links: LinkJson[];
  /** Global search results while a non-URL query is active. */
  results: SearchResultJson[];
  /** True when the omnibar carries a non-empty, non-URL query (search mode). */
  searchEnabled: boolean;
  isLoading: boolean;
  isError: boolean;
  error: ApiError | undefined;
  isSearching: boolean;
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  /**
   * The omnibar's `keep ↵` handler (plan 011, V3-3) — captures `omnibar.q`
   * via `useCaptureLink`, scoped to `tag` when this view has one (a link kept
   * while viewing `#ai` picks up `#ai`), then clears the omnibar. A no-op
   * when `q` doesn't currently look like a URL, matching the Omnibar
   * component's own `omniIsUrl` guard on Enter — this is a second, cheap
   * guard against a stale closure calling `onKeep` after the query changed.
   */
  onKeep: () => void;
  /** True while a capture is in flight — lets the omnibar show a subtle busy state. */
  isCapturing: boolean;
  /**
   * The most recent capture failure's message (`useCaptureLink`'s
   * `ApiError`), or `undefined` when the last capture (if any) succeeded —
   * lets the header surface a calm one-line "couldn't save that" instead of
   * failing silently (the omnibar clears optimistically on every `onKeep`,
   * so a failure MUST be shown somewhere or it's invisible).
   */
  captureError: string | undefined;
  /** Count of links in the current feed still `captureStatus === 'enriching'` — feeds the header's `◌` indicator. */
  enrichingCount: number;
}

export function useListView(tag?: string): ListViewState {
  const { data: counts } = useCounts();
  const { data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteLinks(tag);
  const omnibar = useOmnibarState();
  const captureLink = useCaptureLink();

  const searchEnabled = omnibar.debouncedQ.trim().length > 0 && !omnibar.isUrl;
  const { data: searchData, isLoading: isSearching } = useSearchLinks(
    searchEnabled ? omnibar.debouncedQ : '',
  );

  const links = data?.pages.flatMap((page) => page.links) ?? [];

  const onKeep = () => {
    if (!omnibar.isUrl) return;
    const url = omnibar.q.trim();
    if (!url) return;
    captureLink.mutate({ url, ...(tag ? { tags: [tag] } : {}) });
    omnibar.clear();
  };

  return {
    omnibar,
    liveCount: counts?.live,
    links,
    results: searchData?.results ?? [],
    searchEnabled,
    isLoading,
    isError,
    error: error as ApiError | undefined,
    isSearching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage: () => fetchNextPage(),
    onKeep,
    isCapturing: captureLink.isPending,
    captureError: captureLink.isError ? (captureLink.error as ApiError).message : undefined,
    enrichingCount: links.filter((link) => link.captureStatus === 'enriching').length,
  };
}
