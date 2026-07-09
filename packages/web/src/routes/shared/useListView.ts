import { useCallback } from 'react';
import type { ApiError } from '../../api/client';
import { useInfiniteLinks } from '../../api/hooks';
import type { LinkJson } from '../../api/types';

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
 * view's state.
 *
 * Capture removed (later user-feedback pass): the header's `<Omnibar/>` is
 * now a static, non-interactive hint box — it no longer carries a `q`/`isUrl`
 * state or an Enter-to-keep handler, so this hook no longer owns any capture
 * plumbing either. Pasting a URL anywhere on the page still captures it via
 * the document-level `usePasteCapture` listener (`AppFrame`), which owns its
 * own independent `useCaptureLink` mutation.
 */
export interface ListViewState {
  /** The browse feed (day-grouped, paginated), scoped to `tag` when given. */
  links: LinkJson[];
  isLoading: boolean;
  isError: boolean;
  error: ApiError | undefined;
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

export function useListView(tag?: string): ListViewState {
  const { data, isLoading, isError, error, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteLinks(tag);

  const links = data?.pages.flatMap((page) => page.links) ?? [];

  const triggerFetchNextPage = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  return {
    links,
    isLoading,
    isError,
    error: error as ApiError | undefined,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage: triggerFetchNextPage,
  };
}
