import { useCallback } from 'react';
import type { ApiError } from '../../api/client';
import { useCaptureLink, useCounts, useInfiniteLinks } from '../../api/hooks';
import type { LinkJson } from '../../api/types';
import { useOmnibarState } from '../../lib/useOmnibarState';

/**
 * The shared list-view orchestration behind `LibraryView` (`/`) and `TagView`
 * (`/tags/:name`) — plan 011, V3-2. Both screens are the same day-grouped
 * browse feed; the only differences are the optional `tag` scope and each
 * view's title / empty-state / tag-pill chrome (which the route components
 * supply). This hook owns everything else so that orchestration isn't
 * duplicated across the two routes.
 *
 * Search removed (plan 024, command center): the omnibar's inline search
 * mode (and this hook's `results`/`searchEnabled`/`isSearching` fields) is
 * GONE — search now lives entirely in the command palette
 * (`CommandPalette.tsx`, mounted once at the app root), which hits the same
 * `/api/links/search` endpoint directly rather than routing through a list
 * view's state. `omnibar` here is the now-paste-only `useOmnibarState`
 * (`isUrl`/`q`/`clear` for the `keep ↵` capture path + the tag-pill's
 * clear-on-Escape) — it no longer drives any list filtering.
 */
export interface ListViewState {
  omnibar: ReturnType<typeof useOmnibarState>;
  /** Live library count (from `/api/counts`) — the omnibar's "of N" + header count fallback. */
  liveCount: number | undefined;
  /** The browse feed (day-grouped, paginated), scoped to `tag` when given. */
  links: LinkJson[];
  isLoading: boolean;
  isError: boolean;
  error: ApiError | undefined;
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
}

export function useListView(tag?: string): ListViewState {
  const { data: counts } = useCounts();
  const { data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteLinks(tag);
  const omnibar = useOmnibarState();
  const captureLink = useCaptureLink();

  const links = data?.pages.flatMap((page) => page.links) ?? [];

  // Stable across renders (the mutate/clear functions TanStack Query and
  // `useOmnibarState` hand back are themselves stable) so a consumer that
  // memoizes on `onKeep`/`fetchNextPage` — e.g. an effect or a memoized child
  // — doesn't see a new function identity every render for no reason.
  const onKeep = useCallback(() => {
    if (!omnibar.isUrl) return;
    const url = omnibar.q.trim();
    if (!url) return;
    captureLink.mutate({ url, ...(tag ? { tags: [tag] } : {}) });
    omnibar.clear();
  }, [omnibar.isUrl, omnibar.q, omnibar.clear, captureLink.mutate, tag]);

  const triggerFetchNextPage = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  return {
    omnibar,
    liveCount: counts?.live,
    links,
    isLoading,
    isError,
    error: error as ApiError | undefined,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage: triggerFetchNextPage,
    onKeep,
    isCapturing: captureLink.isPending,
    captureError: captureLink.isError ? (captureLink.error as ApiError).message : undefined,
  };
}
