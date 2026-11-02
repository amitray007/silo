import { createContext } from 'react';

/**
 * The reader pane's side of the dock: the element that holds it, the scroll area and the pane
 * itself, so tools can draw beside the prose, and a report of whether Reader prose is visible.
 */
export type DockHost = {
  element: HTMLElement | null;
  scroll: HTMLElement | null;
  panel: HTMLElement | null;
  report: (proseReady: boolean) => void;
};
export const DockHostContext = createContext<DockHost>({
  element: null,
  scroll: null,
  panel: null,
  report: () => {},
});
