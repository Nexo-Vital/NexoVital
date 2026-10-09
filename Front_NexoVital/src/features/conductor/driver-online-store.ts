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
  /**
   * Adopts the connection the SERVER holds for the driver's unit (EP-04.F2.US1).
   * Against the backend the connection is data of the unit, so the screens that
   * read the unit mirror it here and every other screen sees the same value.
   */
  setOnline: (online: boolean) => void;
  /** Session (token) whose automatic connection was already attempted. */
  autoConnectedFor: string | null;
  markAutoConnected: (session: string | null) => void;
}

/**
 * Cross-tree connection state of the driver console, so it survives navigation
 * (it is a store, not page state). In-memory only: there is NO persistence, so a
 * reload always starts disconnected until the unit is read.
 *
 * Demo mode has no backend, so there the flag is the whole truth and the two
 * toggles write it. Against the backend the truth is the unit's `conectada`;
 * `useDriverConnection` mirrors it here with `setOnline`.
 */
export const useDriverOnlineStore = create<DriverOnlineState>((set) => ({
  online: false,
  goOnline: () => set({ online: true }),
  goOffline: () => set({ online: false }),
  setOnline: (online) => set((state) => (state.online === online ? state : { online })),
  autoConnectedFor: null,
  markAutoConnected: (session) => set({ autoConnectedFor: session }),
}));
