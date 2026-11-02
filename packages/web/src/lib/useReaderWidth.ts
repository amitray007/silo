import { useCallback } from 'react';
import { usePref } from './prefStore';
import { type ReaderWidth, readerSync, readerWidthStore } from './readerPrefs';

export type { ReaderWidth };

/** The reading width, kept on this device and synced to the server with the other reader settings. */
export function useReaderWidth() {
  const setWidth = useCallback((width: ReaderWidth) => readerSync.commit({ width }), []);
  return [usePref(readerWidthStore), setWidth] as const;
}
