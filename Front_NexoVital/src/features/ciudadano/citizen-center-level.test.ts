import { describe, expect, it } from 'vitest';
import type { AlertaEscasez, CentroAyuda, InventarioItem, TrafficLight } from '@/types/domain';
import {
  CENTER_LEVEL_STYLE,
  CITIZEN_LEVEL_TRAFFIC,
  centerAlerts,
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

/** An alert as the map read-model sends it: 12 of 20, so 8 are missing (AMBER). */
const ALERTA: AlertaEscasez = {
  itemId: 'INV-1',
  nombre: 'Alimentos',
  requerido: 20,
  disponible: 12,
  faltante: 8,
};

describe('centerAlerts', () => {
  it('is empty when nothing is known about the center', () => {
    expect(centerAlerts(centro())).toEqual([]);
    expect(hasActiveAlert(centro())).toBe(false);
  });

  it('derives one alert per item below its maximum, most missing first', () => {
    const items: InventarioItem[] = [
      { ...item('GREEN', 'Cobijas'), disponible: 44, requerido: 50 },
      { ...item('RED', 'Agua potable'), disponible: 12, requerido: 60 },
      { ...item('COMPLETE', 'Alimentos'), disponible: 30, requerido: 30 },
      { ...item('COMPLETE', 'Sobrante'), disponible: 9, requerido: 0 },
    ];

    expect(centerAlerts(centro({ items }))).toEqual([
      {
        itemId: 'INV-Agua potable',
        nombre: 'Agua potable',
        requerido: 60,
        disponible: 12,
        faltante: 48,
      },
      { itemId: 'INV-Cobijas', nombre: 'Cobijas', requerido: 50, disponible: 44, faltante: 6 },
    ]);
  });

  it('follows the inventory, not a stale map alert, once the inventory is known', () => {
    const covered: InventarioItem = { ...item('COMPLETE'), disponible: 100, requerido: 100 };

    expect(centerAlerts(centro({ items: [covered], alertas: [ALERTA], alerta: ALERTA }))).toEqual(
      [],
    );
    // Read and empty: the center needs nothing, whatever an older payload said.
    expect(centerAlerts(centro({ inventarioCargado: true, alertas: [ALERTA] }))).toEqual([]);
  });

  it('uses the alerts the map sent while the inventory is still unknown', () => {
    const menor: AlertaEscasez = { ...ALERTA, itemId: 'INV-2', nombre: 'Cobijas', faltante: 2 };

    expect(centerAlerts(centro({ alertas: [menor, ALERTA] }))).toEqual([ALERTA, menor]);
    expect(centerAlerts(centro({ alerta: ALERTA }))).toEqual([ALERTA]);
    expect(hasActiveAlert(centro({ alerta: ALERTA }))).toBe(true);
  });
});

describe('centerLevel', () => {
  it('is null only when there is neither inventory nor alert information', () => {
    expect(centerLevel(centro())).toBeNull();
    expect(centerLevel(centro({ items: [item('NOT_DECLARED')] }))).toBeNull();
  });

  it('is stable from a GREEN inventory', () => {
    expect(centerLevel(centro({ items: [item('GREEN')] }))).toBe('stable');
  });

  it('is alert from an AMBER inventory', () => {
    expect(centerLevel(centro({ items: [item('AMBER')] }))).toBe('alert');
  });

  it('is critical from a RED inventory', () => {
    expect(centerLevel(centro({ items: [item('GREEN'), item('RED')] }))).toBe('critical');
  });

  it('is complete when the inventory was read and is empty', () => {
    expect(centerLevel(centro({ inventarioCargado: true }))).toBe('complete');
  });

  it('does NOT raise a GREEN center to alert because it is missing something', () => {
    // 90 of 100 is GREEN and still has an alert (10 missing): the level is the
    // traffic light, the alert only names what is missing.
    const green: InventarioItem = { ...item('GREEN'), disponible: 90, requerido: 100 };

    expect(hasActiveAlert(centro({ items: [green] }))).toBe(true);
    expect(centerLevel(centro({ items: [green] }))).toBe('stable');
  });

  it('takes the level from the map alerts while the inventory is unknown', () => {
    // 12 of 20 is 60%: AMBER.
    expect(centerLevel(centro({ alertas: [ALERTA] }))).toBe('alert');
    // 1 of 20 is 5%: RED wins over the AMBER one.
    const roja: AlertaEscasez = { ...ALERTA, itemId: 'INV-2', disponible: 1, faltante: 19 };
    expect(centerLevel(centro({ alertas: [ALERTA, roja] }))).toBe('critical');
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
