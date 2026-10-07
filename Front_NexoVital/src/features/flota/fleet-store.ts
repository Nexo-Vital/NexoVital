import { create } from 'zustand';
import type { Ambulancia } from '@/types/domain';

/**
 * `true` when `incoming` is OLDER than what the store already holds for the
 * same unit (EP-04.F1.US1, D6).
 *
 * The backend stamps every write on a unit with the row version, a counter that
 * only grows. The pushes leave after commit, each on its own thread, so two
 * writes on the same unit can reach the channel inverted; the version is what
 * tells them apart. An EQUAL version is not stale: the state frame and the
 * position frame of the same write share it.
 *
 * A side without a version (demo fixtures, the dev relay, the fleet manager)
 * can never be ordered, so it is never stale: that path keeps the previous
 * last-writer-wins behaviour.
 */
export function isStaleVersion(held: number | undefined, incoming: number | undefined): boolean {
  return held !== undefined && incoming !== undefined && incoming < held;
}

interface FleetState {
  units: Ambulancia[];
  /**
   * Replace the fleet with a snapshot (the fixtures or `GET /flota/ambulancias`).
   *
   * The snapshot decides WHICH units exist and their identity (plate, zone). The
   * only exception is a unit the store already holds at a NEWER version: a frame
   * that landed while the REST read was on its way must not be undone by the
   * older snapshot, so that unit keeps its live fields (D6).
   */
  hydrate: (units: Ambulancia[]) => void;
  /**
   * UPSERT: create the unit when the id is unknown, merge it when it already
   * exists. This is what makes units created on another client appear here.
   */
  upsert: (unit: Ambulancia) => void;
  /**
   * Adopt a unit the server returned from a command (connect, disconnect), with
   * the same ordering rule as a frame: it is dropped when the store already
   * holds that unit at a NEWER version. The command's own frame travels on
   * `/topic/flota` too, and either of the two can land first.
   */
  adopt: (unit: Ambulancia) => void;
  remove: (id: string) => void;
  /**
   * Drop the version of every held unit, keeping everything else.
   *
   * A version only orders the frames of ONE uninterrupted subscription. Once
   * the channel drops (or nobody was listening), what the store holds may be
   * arbitrarily old, and after a backend restart with a fresh database the
   * counter starts again from zero: a held version would then discard every
   * new frame and every snapshot. Forgetting it makes the next frame or
   * snapshot win, and the ordering starts again from there.
   */
  forgetVersions: () => void;
}

/**
 * CRUE fleet source of truth. Every mutation (create/edit/delete) goes through
 * this store; the publishing side (`use-fleet-sync` + the manager dialog) then
 * mirrors it on /topic/flota so other connected clients converge.
 */
export const useFleetStore = create<FleetState>((set) => ({
  units: [],
  hydrate: (snapshot) =>
    set((state) => {
      if (state.units.length === 0) {
        return { units: snapshot };
      }
      const held = new Map(state.units.map((unit) => [unit.id, unit]));
      const units = snapshot.map((unit) => {
        const local = held.get(unit.id);
        if (local === undefined || !isStaleVersion(local.version, unit.version)) {
          return unit;
        }
        return {
          ...unit,
          estado: local.estado,
          ubicacion: local.ubicacion,
          heading: local.heading,
          source: local.source,
          sinSenal: local.sinSenal,
          ultimaPosicionEn: local.ultimaPosicionEn,
          conectada: local.conectada,
          version: local.version,
        };
      });
      return { units };
    }),
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
  adopt: (unit) =>
    set((state) => {
      const index = state.units.findIndex((item) => item.id === unit.id);
      if (index === -1) {
        return { units: [...state.units, unit] };
      }
      if (isStaleVersion(state.units[index].version, unit.version)) {
        return state;
      }
      const units = state.units.slice();
      units[index] = { ...units[index], ...unit };
      return { units };
    }),
  remove: (id) => set((state) => ({ units: state.units.filter((item) => item.id !== id) })),
  forgetVersions: () =>
    set((state) => {
      if (state.units.every((unit) => unit.version === undefined)) {
        return state;
      }
      return { units: state.units.map((unit) => ({ ...unit, version: undefined })) };
    }),
}));
