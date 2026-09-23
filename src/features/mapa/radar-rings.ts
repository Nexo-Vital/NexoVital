import { distanceKm } from '@/lib/geo';
import type { Ambulancia, Ubicacion } from '@/types/domain';

/**
 * Citizen radar geometry.
 *
 * The mockup drew the search rings as fixed 300/200/120 px circles, which say
 * nothing about the ground they cover: on a real map that lie changes with every
 * zoom level. Here the rings are anchored to a DISTANCE instead. The outer ring
 * reaches the farthest unit the active search alerted ("this far we search") and
 * the two inner rings keep the mockup's proportions of it. Everything in this
 * module is pure, so the terrain maths is unit-testable without a map.
 */

/** Mockup radii (300/200/120 px) as fractions of the outer ring. */
export const RADAR_RING_RATIOS = {
  outer: 1,
  middle: 200 / 300,
  inner: 120 / 300,
} as const;

export interface RadarRingRadii {
  /** The farthest alerted unit's real distance, in kilometres. */
  outerKm: number;
  middleKm: number;
  innerKm: number;
}

/**
 * Real ground radius of the outer ring: the distance to the FARTHEST unit the
 * active search alerted. Returns `null` when none of the alerted units is on the
 * map (there is nothing to measure), which is the caller's signal to draw no
 * rings at all.
 */
export function outerRingRadiusKm(
  origin: Ubicacion,
  units: readonly Ambulancia[],
  notifiedIds: readonly string[],
): number | null {
  let farthestKm: number | null = null;
  for (const unit of units) {
    if (!notifiedIds.includes(unit.id)) {
      continue;
    }
    const km = distanceKm(origin, unit.ubicacion);
    if (farthestKm === null || km > farthestKm) {
      farthestKm = km;
    }
  }
  return farthestKm;
}

/** The three ring radii, in kilometres, derived from the outer one. */
export function radarRingRadiiKm(outerKm: number): RadarRingRadii {
  return {
    outerKm,
    middleKm: outerKm * RADAR_RING_RATIOS.middle,
    innerKm: outerKm * RADAR_RING_RATIOS.inner,
  };
}

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const TILE_SIZE_PX = 256;

/**
 * Web Mercator ground resolution: how many pixels one metre spans at `zoom` and
 * `latitude`, for Leaflet's default CRS (256 px tiles). The result is linear in
 * `cos(latitude)`, and the caller recomputes it whenever the zoom settles, so a
 * ring covers the same metres at every zoom level.
 */
export function metersToPixels(meters: number, latitude: number, zoom: number): number {
  const metersPerPixel =
    (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180)) / (TILE_SIZE_PX * 2 ** zoom);
  return meters / metersPerPixel;
}

/** Pixel diameter of a ring's icon for a ground radius at the given zoom. */
export function radarRingsPixelDiameter(outerKm: number, latitude: number, zoom: number): number {
  return 2 * metersToPixels(outerKm * 1000, latitude, zoom);
}
