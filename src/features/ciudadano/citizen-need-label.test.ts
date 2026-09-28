import { describe, expect, it } from 'vitest';
import type { AlertaEscasez, CentroAyuda, InventarioItem, TrafficLight } from '@/types/domain';
import { centerNeedLabel } from './citizen-view';

/** A declared inventory item; the name lets a case pick a mass or plural noun. */
function item(semaforo: TrafficLight, nombre: string): InventarioItem {
  return {
    id: `INV-${nombre}`,
    centroAcopioId: 'C-1',
    nombre,
    disponible: 5,
    requerido: 100,
    semaforo,
  };
}

function centro(overrides: Partial<CentroAyuda> = {}): CentroAyuda {
  return {
    id: 'C-1',
    nombre: 'Acopio Test',
    ubicacion: { lat: 0, lng: 0 },
    items: [],
    ...overrides,
  };
}

/** The backend's worst active alert, verbatim from `CentroDto.alerta`. */
const ALERTA: AlertaEscasez = {
  itemId: 'INV-1',
  nombre: 'Alimentos',
  cantidadSolicitada: 20,
  faltante: 8,
  creadaEn: '2026-09-27T10:00:00Z',
};

describe('centerNeedLabel', () => {
  it('states the inventory is enough when the center is stable', () => {
    expect(centerNeedLabel(centro({ items: [item('GREEN', 'Alimentos')] }))).toBe(
      'Inventario suficiente',
    );
  });

  it('uses a number-agnostic template for a mass noun', () => {
    expect(centerNeedLabel(centro({ items: [item('RED', 'Agua potable')] }))).toBe(
      'Faltante: agua potable',
    );
  });

  it('uses the same template for a countable plural noun, with no verb agreement to guess', () => {
    expect(centerNeedLabel(centro({ items: [item('AMBER', 'Cobijas')] }))).toBe(
      'Faltante: cobijas',
    );
  });

  it('names the missing resource from the active alert when no item is declared', () => {
    expect(centerNeedLabel(centro({ alerta: ALERTA }))).toBe('Faltante: alimentos');
  });

  it('claims nothing when there is no inventory and no alert', () => {
    expect(centerNeedLabel(centro())).toBe('Sin requerimientos declarados');
  });
});
