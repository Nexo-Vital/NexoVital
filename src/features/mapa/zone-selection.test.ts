import { describe, expect, it } from 'vitest';
import type { CentroAyuda, Zona } from '@/types/domain';
import { zoneAreaPositions, zoneForCentro } from './zone-selection';

const SUBA_CONTOUR = [
  { lat: 4.79, lng: -74.1 },
  { lat: 4.795, lng: -74.05 },
  { lat: 4.755, lng: -74.032 },
  { lat: 4.7, lng: -74.05 },
];

const ZONAS: Zona[] = [
  {
    id: 'Z-SUBA',
    nombre: 'Suba',
    ubicacion: { lat: 4.742, lng: -74.09 },
    contorno: SUBA_CONTOUR,
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

  it('draws nothing when the center declares no zone (the demo fixtures)', () => {
    expect(zoneForCentro(ZONAS, centro())).toBeNull();
  });

  it('draws nothing when no zone carries that id, instead of the wrong pin', () => {
    expect(zoneForCentro(ZONAS, centro('Z-UNKNOWN'))).toBeNull();
  });

  it('draws nothing without a selected center', () => {
    expect(zoneForCentro(ZONAS, null)).toBeNull();
    expect(zoneForCentro(ZONAS, undefined)).toBeNull();
  });
});

describe('zoneAreaPositions', () => {
  it('maps every contour vertex, in order, to a Leaflet position', () => {
    // The polygon IS the zone: same vertices, same order, lat/lng as [lat, lng].
    expect(zoneAreaPositions(ZONAS[0])).toEqual([
      [4.79, -74.1],
      [4.795, -74.05],
      [4.755, -74.032],
      [4.7, -74.05],
    ]);
  });

  it('draws nothing when the zone carries no contour', () => {
    // Kennedy declares no geometry: an absent contour must not paint an area.
    expect(zoneAreaPositions(ZONAS[1])).toBeNull();
  });

  it('draws nothing for a contour that cannot enclose an area', () => {
    const twoVertices: Zona = {
      id: 'Z-LINE',
      nombre: 'Line',
      ubicacion: { lat: 4.7, lng: -74.05 },
      contorno: [
        { lat: 4.7, lng: -74.05 },
        { lat: 4.71, lng: -74.06 },
      ],
    };
    expect(zoneAreaPositions(twoVertices)).toBeNull();
  });

  it('draws nothing without a zone', () => {
    expect(zoneAreaPositions(null)).toBeNull();
    expect(zoneAreaPositions(undefined)).toBeNull();
  });
});
