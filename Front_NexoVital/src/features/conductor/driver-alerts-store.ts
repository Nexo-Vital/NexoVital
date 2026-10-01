import { create } from 'zustand';
import type { EmergencyLevel, Ubicacion } from '@/types/domain';

/**
 * A surfaced pending offer, as the shell bell needs it: identity, type, the
 * optional severity, the requester scene when it is known and the accept
 * deadline. A minimal projection of the real `SolicitudBroadcastPayload`.
 *
 * `escena` is optional on purpose: the payload may not carry coordinates, and
 * this store never invents a point. The panel then says "Sin ubicación".
 */
export interface DriverAlert {
  requestId: string;
  tipo: string;
  nivel?: EmergencyLevel;
  escena?: Ubicacion;
  /** ISO instant the accept window closes; empty when the frame carries none. */
  timeoutEn: string;
}

interface DriverAlertsState {
  /**
   * Pending requests the driver shell mirrors in the topbar bell via
   * `AppFrame`'s optional `bellCount`. The driver console is the only writer;
   * every other role leaves it at zero, so their bell stays badge-less.
   */
  pendingRequests: number;
  /**
   * The surfaced pending offers themselves, so the bell can list them. Same
   * writer as `pendingRequests`, gated by the console's connection.
   */
  pending: DriverAlert[];
  /**
   * Sets `pending` and keeps `pendingRequests` in sync. A focus signal for a
   * request that is no longer pending is dropped with it.
   */
  setPending: (alerts: DriverAlert[]) => void;
  /**
   * The request the driver console should focus, set when the driver opens a
   * notification from the shell. The console consumes it and calls `clearFocus`.
   */
  focusRequestId: string | null;
  /** Asks the driver console to select and centre the given request. */
  focusRequest: (requestId: string) => void;
  /** Clears the focus signal once the console has acted on it. */
  clearFocus: () => void;
}

/** Cross-tree channel between the driver console and the shell chrome. */
export const useDriverAlertsStore = create<DriverAlertsState>((set) => ({
  pendingRequests: 0,
  pending: [],
  setPending: (pending) =>
    set((state) => ({
      pending,
      pendingRequests: pending.length,
      // A focus for a request that left the list would point at nothing.
      focusRequestId:
        state.focusRequestId !== null &&
        pending.some((alert) => alert.requestId === state.focusRequestId)
          ? state.focusRequestId
          : null,
    })),
  focusRequestId: null,
  focusRequest: (focusRequestId) => set({ focusRequestId }),
  clearFocus: () => set({ focusRequestId: null }),
}));
