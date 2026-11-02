import { createContext } from 'react';

/**
 * The reader pane's side of the dock: the element that holds it, the scroll area and the pane
 * itself, so tools can draw beside the prose, and a report of whether a dock is mounted. The
 * pane themes itself only while one is.
 */
export type DockHost = {
  element: HTMLElement | null;
  scroll: HTMLElement | null;
  panel: HTMLElement | null;
  report: (mounted: boolean) => void;
};
export const DockHostContext = createContext<DockHost>({
  element: null,
  scroll: null,
  panel: null,
  report: () => {},
});
