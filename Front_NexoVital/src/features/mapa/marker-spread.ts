import { distanceKm } from '@/lib/geo';
import type { Ubicacion } from '@/types/domain';

/** Screen gap, in px, a marker needs so it does not cover its neighbour (shape + label). */
export const MARKER_SPACING_PX = 60;

const METERS_PER_DEGREE_LAT = (6_371_000 * Math.PI) / 180;
const MAX_RINGS = 6;

/** Meters covered by one screen pixel at this latitude and zoom (Web Mercator). */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Point `meters` away from `origin` in the direction `angle` (radians, 0 = north). */
function offset(origin: Ubicacion, meters: number, angle: number): Ubicacion {
  const dLat = (meters * Math.cos(angle)) / METERS_PER_DEGREE_LAT;
  const dLng =
    (meters * Math.sin(angle)) / (METERS_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180));
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}

/** Earlier items keep their point; a covering one moves to the nearest free slot. */
export function spreadPositions<T extends { id: string; ubicacion: Ubicacion }>(
  items: readonly T[],
  minMeters: number,
): Map<string, Ubicacion> {
  const placed: Ubicacion[] = [];
  const result = new Map<string, Ubicacion>();
  const isFree = (point: Ubicacion) =>
    placed.every((other) => distanceKm(point, other) * 1000 >= minMeters * 0.999);

  for (const item of items) {
    let position = item.ubicacion;
    if (minMeters > 0 && !isFree(position)) {
      search: for (let ring = 1; ring <= MAX_RINGS; ring += 1) {
        const slots = 6 * ring;
        for (let slot = 0; slot < slots; slot += 1) {
          const candidate = offset(item.ubicacion, ring * minMeters, (2 * Math.PI * slot) / slots);
          if (isFree(candidate)) {
            position = candidate;
            break search;
          }
        }
      }
    }
    placed.push(position);
    result.set(item.id, position);
  }
  return result;
}
