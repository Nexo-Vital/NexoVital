import { create } from 'zustand';
import type { SolicitudAmbulancia } from '@/types/domain';

interface SolicitudesState {
  items: SolicitudAmbulancia[];
  /** Replace the whole registry (fixtures or an API page). */
  hydrate: (items: SolicitudAmbulancia[]) => void;
  /** UPSERT a request so a newly published request appears in the registry. */
  upsert: (solicitud: SolicitudAmbulancia) => void;
  /** Apply the server-side arbiter decision: the winning unit owns the request. */
  markTaken: (requestId: string, winner: string) => void;
  /** Record the winning unit's declared arrival from `request.arrived`. */
  markArrived: (requestId: string) => void;
  /** Apply the citizen's confirmation from `request.confirmed`. */
  markConfirmed: (requestId: string) => void;
  /**
   * Record that a unit declined a request (EP-04.F2.US5). The row stays in the
   * registry and stays PENDING: only that unit can no longer answer it.
   */
  markRejected: (requestId: string, unitId: string) => void;
  /** Drop a request that was withdrawn, so the registry stops showing it. */
  remove: (requestId: string) => void;
}

/** Bottom-strip request registry source of truth (read-only for the CRUE). */
export const useSolicitudesStore = create<SolicitudesState>((set) => ({
  items: [],
  hydrate: (items) => set({ items }),
  upsert: (solicitud) =>
    set((state) => {
      const index = state.items.findIndex((item) => item.id === solicitud.id);
      if (index === -1) {
        return { items: [solicitud, ...state.items] };
      }
      const items = state.items.slice();
      items[index] = { ...items[index], ...solicitud };
      return { items };
    }),
  markTaken: (requestId, winner) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === requestId ? { ...item, estado: 'TAKEN', ambulanciaAsignadaId: winner } : item,
      ),
    })),
  markArrived: (requestId) =>
    set((state) => ({
      items: state.items.map((item) =>
        // Idempotent: a repeated arrival must not move the recorded instant.
        item.id === requestId && item.llegadaEn === undefined
          ? { ...item, llegadaEn: new Date().toISOString() }
          : item,
      ),
    })),
  markConfirmed: (requestId) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === requestId ? { ...item, estado: 'CONFIRMED' } : item,
      ),
    })),
  markRejected: (requestId, unitId) =>
    set((state) => ({
      items: state.items.map((item) =>
        // Idempotent: declining twice lists the unit once.
        item.id === requestId && !(item.ambulanciasRechazaron ?? []).includes(unitId)
          ? { ...item, ambulanciasRechazaron: [...(item.ambulanciasRechazaron ?? []), unitId] }
          : item,
      ),
    })),
  remove: (requestId) =>
    set((state) => ({ items: state.items.filter((item) => item.id !== requestId) })),
}));
