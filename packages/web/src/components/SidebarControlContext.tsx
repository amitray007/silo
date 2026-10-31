import { createContext, useContext } from 'react';

/**
 * The app sidebar as a tool inside the frame can use it. `AppFrame` owns the sidebar and
 * provides this; a component outside it (a test) gets a sidebar that cannot move.
 */
export type SidebarControl = {
  /** The docked sidebar is collapsed. */
  collapsed: boolean;
  /** How much width the pane gains when the sidebar collapses: 0 when it is not docked or already collapsed. */
  freedWidth: () => number;
  /**
   * Collapse or expand the docked sidebar for now. The change is not saved, so the reader's own
   * saved choice (the `[` key) survives a tool that borrowed the room.
   */
  setCollapsed: (collapsed: boolean) => void;
};

const FIXED: SidebarControl = { collapsed: false, freedWidth: () => 0, setCollapsed: () => {} };

export const SidebarControlContext = createContext<SidebarControl>(FIXED);

export function useSidebarControl(): SidebarControl {
  return useContext(SidebarControlContext);
}
