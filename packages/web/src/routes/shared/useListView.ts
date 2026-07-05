import type { ApiError } from '../../api/client';
import { useCounts, useInfiniteLinks, useSearchLinks } from '../../api/hooks';
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
}

export function useListView(tag?: string): ListViewState {
  const { data: counts } = useCounts();
  const { data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteLinks(tag);
  const omnibar = useOmnibarState();

  const searchEnabled = omnibar.debouncedQ.trim().length > 0 && !omnibar.isUrl;
  const { data: searchData, isLoading: isSearching } = useSearchLinks(
    searchEnabled ? omnibar.debouncedQ : '',
  );

  return {
    omnibar,
    liveCount: counts?.live,
    links: data?.pages.flatMap((page) => page.links) ?? [],
    results: searchData?.results ?? [],
    searchEnabled,
    isLoading,
    isError,
    error: error as ApiError | undefined,
    isSearching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage: () => fetchNextPage(),
  };
}
