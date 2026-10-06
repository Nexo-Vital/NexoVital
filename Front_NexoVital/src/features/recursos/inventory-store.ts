import { create } from 'zustand';
import type { CentroAyuda, InventarioItem } from '@/types/domain';

interface InventoryState {
  /** Items por id de centro: la foto del backend más cada upsert de tiempo real. */
  itemsByCentro: Record<string, InventarioItem[]>;
  /** Reemplaza el inventario de un centro (una foto del backend). */
  hydrate: (centroId: string, items: InventarioItem[]) => void;
  /** UPSERT: crea el item si su id es desconocido, lo fusiona si ya existe. */
  upsert: (item: InventarioItem) => void;
  reset: () => void;
}

/**
 * Estado compartido del inventario por centro. La UI lo lee para pintar el
 * semáforo real de cada centro y es el mismo estado que alimentan la lectura
 * REST y el suscriptor de `/topic/suministros`, así que una donación hecha en
 * otro cliente converge aquí.
 */
export const useInventarioStore = create<InventoryState>((set) => ({
  itemsByCentro: {},
  hydrate: (centroId, items) =>
    set((state) => ({ itemsByCentro: { ...state.itemsByCentro, [centroId]: items } })),
  upsert: (item) =>
    set((state) => {
      const current = state.itemsByCentro[item.centroAcopioId] ?? [];
      const index = current.findIndex((entry) => entry.id === item.id);
      const items =
        index === -1
          ? [...current, item]
          : current.map((entry, position) => (position === index ? { ...entry, ...item } : entry));
      return { itemsByCentro: { ...state.itemsByCentro, [item.centroAcopioId]: items } };
    }),
  reset: () => set({ itemsByCentro: {} }),
}));

/**
 * Superpone el inventario que lee la UI sobre los centros base, preservando su
 * orden. Un centro sin entrada conserva los items que ya traía (los fixtures de
 * demo), así que el mismo merge sirve para las dos builds.
 */
export function withInventario(
  centros: CentroAyuda[],
  itemsByCentro: Record<string, InventarioItem[]>,
): CentroAyuda[] {
  return centros.map((centro) => {
    const items = itemsByCentro[centro.id];
    return items === undefined ? centro : { ...centro, items, inventarioCargado: true };
  });
}
