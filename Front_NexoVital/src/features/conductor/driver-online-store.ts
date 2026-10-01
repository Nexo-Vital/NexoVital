import { create } from 'zustand';

interface DriverOnlineState {
  /**
   * Whether the driver is connected to the service. Disconnected, the console
   * surfaces NO offers; the realtime transport itself keeps running (flota and
   * emergencias stay in sync), so this flag gates the offer surface ONLY.
   */
  online: boolean;
  /** Connects the driver: offers may surface again. Never touches the transport. */
  goOnline: () => void;
  /** Disconnects the driver: the offer surface clears. Never touches the transport. */
  goOffline: () => void;
}

/**
 * Cross-tree connection state of the driver console, so it survives navigation
 * (it is a store, not page state). In-memory only: there is NO persistence, so a
 * reload always starts disconnected.
 */
export const useDriverOnlineStore = create<DriverOnlineState>((set) => ({
  online: false,
  goOnline: () => set({ online: true }),
  goOffline: () => set({ online: false }),
}));
