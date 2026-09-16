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
}));
