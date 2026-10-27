import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, useSyncExternalStore } from 'react';
import { apiGet, apiUrl } from '../../api/client';
import { queryKeys, useFrameHint } from '../../api/hooks';
import type { FrameHint, LinkJson } from '../../api/types';
import { useLightPage } from '../../lib/useLightPage';
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

function pageHostname(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

/** True for the app or API origin. A live frame there, with allow-same-origin, would reach the app. */
function isAppOrigin(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const origin = new URL(url).origin;
    return (
      origin === window.location.origin || origin === new URL(apiUrl('/'), location.href).origin
    );
  } catch {
    return false;
  }
}

function originalMode(embed: boolean, hinted: FrameHint['mode'] | undefined, appOrigin: boolean) {
  if (embed) return 'player' as const;
  if (hinted === 'direct') return appOrigin ? ('view' as const) : hinted;
  return hinted === 'view' ? hinted : ('card' as const);
}

export function useOriginal(link: LinkJson | undefined, active: boolean) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme);
  const url = link ? originalUrl(link.url) : undefined;
  const [lightPage, setLightPage] = useLightPage(pageHostname(url));
  const client = useQueryClient();
  const embed = link ? embedFor(link.url, link.sourceData, theme) : undefined;
  const id = link?.id ?? '';
  const hint = useFrameHint(id, active && !embed && Boolean(link && originalUrl(link.url)));
  const [reload, setReload] = useState(0);
  const currentId = useRef(id);
  currentId.current = id;
  // The link id is the mutation variable: the selection can change while a refresh is pending.
  const refresh = useMutation({
    mutationFn: (linkId: string) =>
      apiGet<FrameHint>(`/api/links/${encodeURIComponent(linkId)}/frame?fresh=1`),
    onSuccess: (data, linkId) => {
      client.setQueryData(queryKeys.frame(linkId), data);
      if (linkId === currentId.current) setReload((value) => value + 1);
    },
  });
  const hinted = hint.data?.mode;
  const mode = originalMode(Boolean(embed), hinted, isAppOrigin(url));
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
    enabled: active && mode === 'view',
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const preparing =
    hint.isFetching || refresh.isPending || (mode === 'view' && viewCheck.isFetching);
  const unavailable = mode === 'view' && !viewCheck.isFetching && viewCheck.data !== true;
  return {
    embed,
    theme,
    darkPage: !lightPage,
    toggleDarkPage: () => setLightPage(!lightPage),
    darkTheme: hint.data?.darkTheme,
    mode: unavailable ? ('card' as const) : mode,
    preparing,
    reason: hint.isError || unavailable ? 'fetch-error' : hint.data?.reason,
    reload,
    refresh,
  };
}
export type OriginalState = ReturnType<typeof useOriginal>;
