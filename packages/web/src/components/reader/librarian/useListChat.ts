import { useLibrarianReady } from '../../../api/librarian';
import { layoutMedia, useMediaQuery } from '../../../lib/breakpoints';
import { useChatParam } from '../../../lib/useChatParam';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';

/**
 * Whether the Librarian's chat takes the reader's pane beside a list. A link wins over the chat.
 * Where the pane covers the list, only an explicit `?chat=` opens it. `reader` marks the pane as
 * open (a link, or an explicit chat) and `covering` that it fills the window over the list.
 */
export function useListChat({ linkOpen, trashed }: { linkOpen: boolean; trashed: boolean }) {
  const ready = useLibrarianReady();
  const fullWindow = useMediaQuery(layoutMedia.fullWindowReader);
  const chat = useChatParam();
  const shown = ready && !trashed && !linkOpen && (chat.open || !fullWindow);
  // Escape leaves a chat that covers the whole window, the way it leaves the reader.
  useEscapeLayer(fullWindow && shown, chat.close);
  const reader = linkOpen || (shown && chat.open);
  return { ...chat, shown, reader, covering: fullWindow && reader };
}
