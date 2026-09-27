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
      const current = state.items[index];
      // Convergence must not depend on delivery order: when BOTH sides carry a
      // version, an incoming frame that does not strictly advance it is stale
      // (lower version) or carries no new information (equal version), so it is
      // discarded instead of overwriting state another reader already advanced.
      // Discarding the stale frame here — rather than trying to order the
      // transport — is what makes the final state identical whatever order the
      // frames arrive in. When either side lacks a version we keep applying the
      // incoming event, which is today's (pre-version) behaviour.
      if (
        current.version !== undefined &&
        emergency.version !== undefined &&
        emergency.version <= current.version
      ) {
        return state;
      }
      const items = state.items.slice();
      items[index] = { ...current, ...emergency };
      return { items };
    }),
}));
