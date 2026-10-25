import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { apiGet, apiUrl } from '../../api/client';
import { queryKeys, useFrameHint } from '../../api/hooks';
import type { FrameHint, LinkJson } from '../../api/types';
import { embedFor } from './embedFor';
import { originalUrl } from './useReaderActions';

function readTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
function subscribeTheme(changed: () => void) {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

type FrameMode = 'direct' | 'view';
function originalMode(
  embed: unknown,
  hint: FrameHint | undefined,
  selected: FrameMode | undefined,
) {
  const canView =
    hint?.mode === 'view' ||
    (hint?.mode === 'direct' &&
      /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(hint.contentType ?? 'text/html'));
  const mode = embed
    ? ('player' as const)
    : hint?.mode === 'direct' || hint?.mode === 'view'
      ? (selected ?? hint.mode)
      : ('card' as const);
  return { canView, mode };
}
export function useOriginal(link: LinkJson | undefined, active: boolean) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme);
  const client = useQueryClient();
  const embed = link ? embedFor(link.url, link.sourceData, theme) : undefined;
  const id = link?.id ?? '';
  const hint = useFrameHint(id, active && !embed && Boolean(link && originalUrl(link.url)));
  const [choice, setChoice] = useState<{ id: string; mode: FrameMode }>();
  const [reload, setReload] = useState(0);
  const refresh = useMutation({
    mutationFn: () => apiGet<FrameHint>(`/api/links/${encodeURIComponent(id)}/frame?fresh=1`),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.frame(id), data);
      setReload((value) => value + 1);
    },
  });
  const { canView, mode } = originalMode(
    embed,
    hint.data,
    choice?.id === id ? choice.mode : undefined,
  );
  const viewCheck = useQuery({
    queryKey: ['page-view-ready', id, reload],
    queryFn: async ({ signal }) =>
      (
        await fetch(apiUrl(`/api/links/${encodeURIComponent(id)}/view`), {
          method: 'HEAD',
          credentials: 'include',
          cache: 'no-store',
          signal,
        })
      ).ok,
    enabled: active && mode === 'view' && canView,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const preparing =
    hint.isFetching || refresh.isPending || (mode === 'view' && viewCheck.isFetching);
  const unavailable =
    mode === 'view' && (!canView || (!viewCheck.isFetching && viewCheck.data !== true));
  return {
    embed,
    mode: unavailable ? ('card' as const) : mode,
    preparing,
    canView,
    canDirect: hint.data?.mode === 'direct',
    reload,
    refresh,
    switchMode: (mode: FrameMode) => setChoice({ id, mode }),
  };
}
export type OriginalState = ReturnType<typeof useOriginal>;
