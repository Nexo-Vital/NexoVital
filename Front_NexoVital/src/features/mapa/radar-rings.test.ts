import { describe, expect, it } from 'vitest';
import {
  metersToPixels,
  outerRingRadiusKm,
  RADAR_RING_RATIOS,
  radarRingRadiiKm,
  radarRingsPixelDiameter,
} from '@/features/mapa/radar-rings';
import { distanceKm } from '@/lib/geo';
import type { Ambulancia, Ubicacion } from '@/types/domain';

const ORIGIN: Ubicacion = { lat: 4.72, lng: -74.078 };

function amb(id: string, lat: number, lng = ORIGIN.lng): Ambulancia {
  return {
    id,
    placa: `TST-${id}`,
    estado: 'AVAILABLE',
    ubicacion: { lat, lng },
    zona: 'Suba',
    driverName: `Driver ${id}`,
  };
}

describe('radar ring geometry', () => {
  it('measures the outer radius to the farthest alerted unit', () => {
    const near = amb('A-NEAR', 4.722);
    const far = amb('A-FAR', 4.78);
    const notAlerted = amb('A-OCCUPIED', 4.9); // farther, but not part of the search

    const km = outerRingRadiusKm(ORIGIN, [near, far, notAlerted], ['A-NEAR', 'A-FAR']);
    if (km === null) {
      throw new Error('expected the farthest alerted unit to give a radius');
    }

    expect(km).toBeCloseTo(distanceKm(ORIGIN, far.ubicacion), 6);
    // The un-alerted unit, though farther, must never widen the search.
    expect(km).toBeLessThan(distanceKm(ORIGIN, notAlerted.ubicacion));
    expect(km).toBeGreaterThan(distanceKm(ORIGIN, near.ubicacion));
  });

  it('has no radius when no alerted unit is on the map', () => {
    expect(outerRingRadiusKm(ORIGIN, [amb('A-07', 4.73)], [])).toBeNull();
    expect(outerRingRadiusKm(ORIGIN, [amb('A-07', 4.73)], ['A-99'])).toBeNull();
  });

  it('keeps the mockup proportions on the two inner rings', () => {
    // The mockup's 300/200/120 px become 100% / 66.7% / 40% of the real radius.
    const radii = radarRingRadiiKm(3);

    expect(radii.outerKm).toBe(3);
    expect(radii.middleKm).toBeCloseTo(2, 10);
    expect(radii.innerKm).toBeCloseTo(1.2, 10);
    expect(RADAR_RING_RATIOS.middle).toBeCloseTo(200 / 300, 10);
    expect(RADAR_RING_RATIOS.inner).toBeCloseTo(120 / 300, 10);
  });

  it('converts metres to pixels using the Web Mercator resolution', () => {
    // One tile at zoom 0 spans the whole equator: 40075016.686 / 256 metres/px.
    expect(metersToPixels(156_543.03392804097, 0, 0)).toBeCloseTo(1, 6);
    // Same ground, double the zoom -> double the pixels.
    expect(metersToPixels(1000, 0, 13)).toBeCloseTo(2 * metersToPixels(1000, 0, 12), 6);
    // The resolution shrinks with cos(latitude): at 60° a metre is 2 px again.
    expect(metersToPixels(1000, 60, 12)).toBeCloseTo(2 * metersToPixels(1000, 0, 12), 6);
  });

  it('sizes the icon diameter from the ground radius at the given zoom', () => {
    expect(radarRingsPixelDiameter(2, 4.72, 12)).toBeCloseTo(2 * metersToPixels(2000, 4.72, 12), 6);
    // Doubling the ground radius doubles the icon, at a fixed zoom.
    expect(radarRingsPixelDiameter(4, 4.72, 12)).toBeCloseTo(
      2 * radarRingsPixelDiameter(2, 4.72, 12),
      6,
    );
  });
});
