import { useCallback } from 'react';
import { type Location, useSearchParams } from 'react-router';

/** `?chat=` holds a chat's id, or this for a new library chat that has no row yet. */
export const NEW_CHAT = 'new';

/** Routes that can show a chat: the Librarian page and the lists that share the reader's pane. */
function hostsChat(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/librarian' ||
    pathname === '/feeds' ||
    pathname.startsWith('/feeds/') ||
    pathname.startsWith('/tags/')
  );
}

/** Where a chat opens from here: beside the current list, or on the Librarian page elsewhere. */
export function chatTo({ pathname, search }: Pick<Location, 'pathname' | 'search'>, id: string) {
  const here = hostsChat(pathname);
  const params = new URLSearchParams(here ? search : '');
  params.delete('link');
  params.set('chat', id);
  return `${here ? pathname : '/librarian'}?${params}`;
}

/** The open chat in the URL: its id (`null` for a new one), and how to switch or leave it. */
export function useChatParam() {
  const [params, setParams] = useSearchParams();
  const param = params.get('chat');
  const show = useCallback(
    (id: string | null, replace = false) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (id) next.set('chat', id);
          else next.delete('chat');
          return next;
        },
        { replace },
      ),
    [setParams],
  );
  const close = useCallback(() => show(null, true), [show]);
  return { open: param !== null, chatId: param === NEW_CHAT ? null : param, show, close };
}
