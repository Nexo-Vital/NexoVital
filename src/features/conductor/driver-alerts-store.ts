import { create } from 'zustand';

interface DriverAlertsState {
  /**
   * Pending requests the driver shell mirrors in the topbar bell via
   * `AppFrame`'s optional `bellCount`. The driver console is the only writer;
   * every other role leaves it at zero, so their bell stays badge-less.
   */
  pendingRequests: number;
  setPendingRequests: (count: number) => void;
}

/** Cross-tree channel between the driver console and the shell chrome. */
export const useDriverAlertsStore = create<DriverAlertsState>((set) => ({
  pendingRequests: 0,
  setPendingRequests: (pendingRequests) => set({ pendingRequests }),
}));
