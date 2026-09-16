import { create } from 'zustand';
import type { Ambulancia } from '@/types/domain';

interface FleetState {
  units: Ambulancia[];
  /** Replace the whole fleet (e.g. hydrate from the fixtures or an API page). */
  hydrate: (units: Ambulancia[]) => void;
  /**
   * UPSERT: create the unit when the id is unknown, merge it when it already
   * exists. This is what makes units created on another client appear here.
   */
  upsert: (unit: Ambulancia) => void;
  remove: (id: string) => void;
}

/**
 * CRUE fleet source of truth. Every mutation (create/edit/delete) goes through
 * this store; the publishing side (`use-fleet-sync` + the manager dialog) then
 * mirrors it on /topic/flota so other connected clients converge.
 */
export const useFleetStore = create<FleetState>((set) => ({
  units: [],
  hydrate: (units) => set({ units }),
  upsert: (unit) =>
    set((state) => {
      const index = state.units.findIndex((item) => item.id === unit.id);
      if (index === -1) {
        return { units: [...state.units, unit] };
      }
      const units = state.units.slice();
      units[index] = { ...units[index], ...unit };
      return { units };
    }),
  remove: (id) => set((state) => ({ units: state.units.filter((item) => item.id !== id) })),
}));
