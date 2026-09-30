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
  remove: (requestId) =>
    set((state) => ({ items: state.items.filter((item) => item.id !== requestId) })),
}));
