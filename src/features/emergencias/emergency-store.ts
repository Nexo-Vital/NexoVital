import { create } from 'zustand';
import type { Emergencia } from '@/types/domain';

interface EmergencyState {
  items: Emergencia[];
  /** Replace the whole list (fixtures or an API page). */
  hydrate: (items: Emergencia[]) => void;
  /**
   * UPSERT: an emergency reported on another client is created locally when its
   * id is unknown, and merged when it already exists.
   */
  upsert: (emergency: Emergencia) => void;
}

/** Shared emergency list consumed by the CRUE map/registry and the driver map. */
export const useEmergencyStore = create<EmergencyState>((set) => ({
  items: [],
  hydrate: (items) => set({ items }),
  upsert: (emergency) =>
    set((state) => {
      const index = state.items.findIndex((item) => item.id === emergency.id);
      if (index === -1) {
        return { items: [...state.items, emergency] };
      }
      const items = state.items.slice();
      items[index] = { ...items[index], ...emergency };
      return { items };
    }),
}));
