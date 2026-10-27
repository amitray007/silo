import { createContext, useContext } from 'react';

export type ReaderSelection = {
  selectedId: string | null;
  select: (id: string) => void;
};

export const ReaderSelectionContext = createContext<ReaderSelection | null>(null);

/** Rows remain ordinary external links when rendered outside a reader layout. */
export function useReaderSelection() {
  return useContext(ReaderSelectionContext);
}
