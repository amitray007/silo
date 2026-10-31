import { createContext, useContext } from 'react';

/**
 * Opens the command palette with a phrase already typed. `AppFrame` owns the palette and
 * provides this; a component outside it (a test) gets a no-op.
 */
export const SearchSiloContext = createContext<(phrase: string) => void>(() => {});

export function useSearchSilo(): (phrase: string) => void {
  return useContext(SearchSiloContext);
}
