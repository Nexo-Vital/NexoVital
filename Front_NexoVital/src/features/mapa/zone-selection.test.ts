import { describe, expect, it } from 'vitest';
import type { CentroAyuda, Zona } from '@/types/domain';
import { zoneForCentro } from './zone-selection';

const ZONAS: Zona[] = [
  {
    id: 'Z-SUBA',
    nombre: 'Suba',
    ubicacion: { lat: 4.742, lng: -74.09 },
  },
  { id: 'Z-KENNEDY', nombre: 'Kennedy', ubicacion: { lat: 4.628, lng: -74.148 } },
];

function centro(zonaId?: string): CentroAyuda {
  return {
    id: 'ORG-SUBA',
    nombre: 'Acopio Suba Norte',
    zonaId,
    ubicacion: { lat: 4.742, lng: -74.09 },
    items: [],
  };
}

describe('zoneForCentro', () => {
  it('resolves the zone whose id matches the center zonaId', () => {
    expect(zoneForCentro(ZONAS, centro('Z-KENNEDY'))?.nombre).toBe('Kennedy');
  });

  it('resolves nothing when the center declares no zone (the demo fixtures)', () => {
    expect(zoneForCentro(ZONAS, centro())).toBeNull();
  });

  it('resolves nothing when no zone carries that id, instead of the wrong pin', () => {
    expect(zoneForCentro(ZONAS, centro('Z-UNKNOWN'))).toBeNull();
  });

  it('resolves nothing without a selected center', () => {
    expect(zoneForCentro(ZONAS, null)).toBeNull();
    expect(zoneForCentro(ZONAS, undefined)).toBeNull();
  });
});
