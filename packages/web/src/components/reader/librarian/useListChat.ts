import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useLibrarianReady } from '../../../api/librarian';
import { layoutMedia, useMediaQuery } from '../../../lib/breakpoints';
import { NEW_CHAT, useChatParam } from '../../../lib/useChatParam';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';

/**
 * Whether the Librarian's chat takes the reader's pane beside a list. A link wins over the chat.
 * Where the pane covers the list, only an explicit `?chat=` opens it. `reader` marks the pane as
 * open (a link, or an explicit chat) and `covering` that it fills the window over the list.
 */
export function useListChat({ linkOpen, trashed }: { linkOpen: boolean; trashed: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const currentLocation = useRef(location);
  currentLocation.current = location;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const created = (id: string) => {
    const current = currentLocation.current;
    const params = new URLSearchParams(current.search);
    const param = params.get('chat');
    if (
      !mounted.current ||
      current.pathname !== location.pathname ||
      params.has('link') ||
      (param !== null && param !== NEW_CHAT)
    )
      return;
    params.set('chat', id);
    void navigate({ ...current, search: `?${params}` }, { replace: true });
  };
  const ready = useLibrarianReady();
  const fullWindow = useMediaQuery(layoutMedia.fullWindowReader);
  const chat = useChatParam();
  const shown = ready && !trashed && !linkOpen && (chat.open || !fullWindow);
  // Escape leaves a chat that covers the whole window, the way it leaves the reader.
  useEscapeLayer(fullWindow && shown, chat.close);
  const reader = linkOpen || (shown && chat.open);
  return { ...chat, created, shown, reader, covering: fullWindow && reader };
}
