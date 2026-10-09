import { describe, expect, it } from 'vitest';
import { distanceKm } from '@/lib/geo';
import { metersPerPixel, spreadPositions } from './marker-spread';

const SPOT = { lat: 4.728, lng: -74.078 };
const GAP = 100;

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return distanceKm(a, b) * 1000;
}

describe('spreadPositions', () => {
  it('keeps markers that do not cover each other where they are', () => {
    const far = { lat: 4.75, lng: -74.05 };
    const positions = spreadPositions(
      [
        { id: 'A', ubicacion: SPOT },
        { id: 'B', ubicacion: far },
      ],
      GAP,
    );
    expect(positions.get('A')).toEqual(SPOT);
    expect(positions.get('B')).toEqual(far);
  });

  it('leaves the first alert on its point and moves the second as close as possible', () => {
    const positions = spreadPositions(
      [
        { id: 'A', ubicacion: SPOT },
        { id: 'B', ubicacion: SPOT },
      ],
      GAP,
    );
    const a = positions.get('A');
    const b = positions.get('B');
    expect(a).toEqual(SPOT);
    expect(b).toBeDefined();
    const gap = meters(a ?? SPOT, b ?? SPOT);
    expect(gap).toBeGreaterThanOrEqual(GAP - 0.5);
    expect(gap).toBeLessThan(GAP * 1.05);
  });

  it('gives every alert of a crowded spot its own free slot', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({ id: `E${index}`, ubicacion: SPOT }));
    const placed = [...spreadPositions(items, GAP).values()];
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(meters(placed[i], placed[j])).toBeGreaterThanOrEqual(GAP - 0.5);
      }
    }
  });

  it('moves an alert that is merely near another, not only an identical point', () => {
    const near = { lat: SPOT.lat + 0.0002, lng: SPOT.lng };
    const positions = spreadPositions(
      [
        { id: 'A', ubicacion: SPOT },
        { id: 'B', ubicacion: near },
      ],
      GAP,
    );
    expect(positions.get('B')).not.toEqual(near);
    expect(meters(SPOT, positions.get('B') ?? near)).toBeGreaterThanOrEqual(GAP - 0.5);
  });
});

describe('metersPerPixel', () => {
  it('halves with every zoom level', () => {
    expect(metersPerPixel(4.7, 15)).toBeCloseTo(metersPerPixel(4.7, 14) / 2, 6);
  });
});
