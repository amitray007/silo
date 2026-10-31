import { createPrefStore, usePref } from './readerPrefs';

export type ReaderWidth = 'narrow' | 'medium' | 'wide';

const readerWidthStore = createPrefStore<ReaderWidth>({
  key: 'silo.readerWidth',
  event: 'silo:reader-width',
  initial: 'medium',
  parse: (raw) => (raw === 'narrow' || raw === 'wide' ? raw : 'medium'),
  serialize: (value) => value,
});

/** A browser-local reading preference; no server setting or account data changes. */
export function useReaderWidth() {
  return [usePref(readerWidthStore), readerWidthStore.set] as const;
}
