import { afterEach, describe, expect, it } from 'vitest';
import type { CentroAyuda, InventarioItem } from '@/types/domain';
import { useInventarioStore, withInventario } from './inventory-store';

function item(
  id: string,
  centroAcopioId: string,
  disponible: number,
  semaforo: InventarioItem['semaforo'],
): InventarioItem {
  return {
    id,
    centroAcopioId,
    nombre: `Item ${id}`,
    disponible,
    requerido: 100,
    semaforo,
  };
}

function centro(id: string, items: InventarioItem[]): CentroAyuda {
  return { id, nombre: `Centro ${id}`, ubicacion: { lat: 0, lng: 0 }, items };
}

describe('useInventarioStore', () => {
  afterEach(() => useInventarioStore.getState().reset());

  it('hydrates a center inventory', () => {
    useInventarioStore.getState().hydrate('c-1', [item('i-1', 'c-1', 10, 'RED')]);

    expect(useInventarioStore.getState().itemsByCentro['c-1']).toHaveLength(1);
  });

  it('upserts by id: creates an unknown item and merges a known one', () => {
    useInventarioStore.getState().hydrate('c-1', [item('i-1', 'c-1', 10, 'RED')]);

    useInventarioStore.getState().upsert(item('i-2', 'c-1', 20, 'AMBER'));
    expect(useInventarioStore.getState().itemsByCentro['c-1'].map((entry) => entry.id)).toEqual([
      'i-1',
      'i-2',
    ]);

    useInventarioStore.getState().upsert(item('i-1', 'c-1', 52, 'GREEN'));
    const items = useInventarioStore.getState().itemsByCentro['c-1'];
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'i-1', disponible: 52, semaforo: 'GREEN' });
  });

  it('keys the items by their own center, never by a caller-provided one', () => {
    useInventarioStore.getState().upsert(item('i-9', 'c-2', 5, 'RED'));

    expect(useInventarioStore.getState().itemsByCentro['c-1']).toBeUndefined();
    expect(useInventarioStore.getState().itemsByCentro['c-2']).toHaveLength(1);
  });
});

describe('withInventario', () => {
  it('overlays the loaded inventory and preserves the base order', () => {
    const base = [centro('c-1', []), centro('c-2', [])];
    const merged = withInventario(base, { 'c-1': [item('i-1', 'c-1', 4, 'RED')] });

    expect(merged.map((entry) => entry.id)).toEqual(['c-1', 'c-2']);
    expect(merged[0].items).toHaveLength(1);
    // A center without an entry keeps the items it already had (the fixtures).
    expect(merged[1]).toBe(base[1]);
  });
});
