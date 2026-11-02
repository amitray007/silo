import { useEffect, useRef } from 'react';
import { apiPatchKeepalive } from '../api/client';
import { useSettings, useUpdateSettings } from '../api/hooks';
import { readerSync } from '../lib/readerPrefs';

/**
 * Connects the reader preferences to `/api/settings`. The server value wins when it arrives (and
 * again whenever it changes while nothing of ours is waiting to be sent); when the server has
 * none, the values this browser already holds are uploaded once. Changes go out through
 * `readerSync`, optimistically, and roll back if the server refuses them.
 *
 * Like `ThemeSettingsSync`, it renders nothing. Without it the preferences still work, kept on
 * this device only.
 */
export function ReaderSettingsSync() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const send = useRef(update.mutateAsync);
  send.current = update.mutateAsync;

  useEffect(
    () =>
      readerSync.connect({
        send: async (reader, writtenAt) => {
          const saved = await send.current({ reader, writtenAt });
          if (!saved.reader) throw new Error('The server did not keep the reader settings');
          return saved.reader;
        },
        keepalive: (reader, writtenAt) => apiPatchKeepalive('/api/settings', { reader, writtenAt }),
      }),
    [],
  );

  const server = settings ? settings.reader : undefined;
  useEffect(() => {
    if (server !== undefined) readerSync.hydrate(server);
  }, [server]);

  return null;
}
