import { describe, expect, it } from 'vitest';
import type { AlertaEscasez, CentroAyuda, InventarioItem, TrafficLight } from '@/types/domain';
import {
  CENTER_LEVEL_STYLE,
  CITIZEN_LEVEL_TRAFFIC,
  centerLevel,
  hasActiveAlert,
} from './citizen-view';

/** A declared inventory item; the traffic light is the backend's own value. */
function item(semaforo: TrafficLight, nombre = 'Agua potable'): InventarioItem {
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

describe('hasActiveAlert', () => {
  it('is false with neither a count nor an alert object', () => {
    expect(hasActiveAlert(centro())).toBe(false);
    expect(hasActiveAlert(centro({ alertasActivas: 0 }))).toBe(false);
  });

  it('is true from either backend source: the count or the worst alert object', () => {
    expect(hasActiveAlert(centro({ alertasActivas: 1 }))).toBe(true);
    expect(hasActiveAlert(centro({ alerta: ALERTA }))).toBe(true);
  });
});

describe('centerLevel', () => {
  it('is null only when there is neither inventory nor alert information', () => {
    expect(centerLevel(centro())).toBeNull();
    expect(centerLevel(centro({ items: [item('NOT_DECLARED')] }))).toBeNull();
  });

  it('is stable from a GREEN inventory with no active alert', () => {
    expect(centerLevel(centro({ items: [item('GREEN')] }))).toBe('stable');
  });

  it('is alert from an AMBER inventory', () => {
    expect(centerLevel(centro({ items: [item('AMBER')] }))).toBe('alert');
  });

  it('is critical from a RED inventory', () => {
    expect(centerLevel(centro({ items: [item('GREEN'), item('RED')] }))).toBe('critical');
  });

  it('is alert from a live alert with NO inventory (the alert source alone)', () => {
    expect(centerLevel(centro({ alertasActivas: 1 }))).toBe('alert');
    expect(centerLevel(centro({ alerta: ALERTA }))).toBe('alert');
  });

  it('is alert from an active alert even when the inventory is GREEN', () => {
    expect(centerLevel(centro({ items: [item('GREEN')], alerta: ALERTA }))).toBe('alert');
  });

  it('keeps critical above an active alert (precedence)', () => {
    expect(centerLevel(centro({ items: [item('RED')], alertasActivas: 2 }))).toBe('critical');
  });

  it('drives one style and one badge per level, with no level left unmapped', () => {
    expect(Object.keys(CENTER_LEVEL_STYLE).sort()).toEqual([
      'alert',
      'complete',
      'critical',
      'stable',
    ]);
    expect(CITIZEN_LEVEL_TRAFFIC).toEqual({
      complete: 'COMPLETE',
      stable: 'GREEN',
      alert: 'AMBER',
      critical: 'RED',
    });
  });
});
