import type { Ubicacion } from '@/types/domain';

const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Great-circle distance between two points, in kilometers. */
export function distanceKm(from: Ubicacion, to: Ubicacion): number {
  const dLat = (to.lat - from.lat) * DEG_TO_RAD;
  const dLng = (to.lng - from.lng) * DEG_TO_RAD;
  const lat1 = from.lat * DEG_TO_RAD;
  const lat2 = to.lat * DEG_TO_RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Parses a latitude input; null when empty, non-numeric or outside [-90, 90]. */
export function parseLatitude(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= -90 && parsed <= 90 ? parsed : null;
}

/** Parses a longitude input; null when empty, non-numeric or outside [-180, 180]. */
export function parseLongitude(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= -180 && parsed <= 180 ? parsed : null;
}

/** Initial bearing from `from` to `to`, in degrees clockwise from north (0-360). */
export function bearingDegrees(from: Ubicacion, to: Ubicacion): number {
  const lat1 = from.lat * DEG_TO_RAD;
  const lat2 = to.lat * DEG_TO_RAD;
  const dLng = (to.lng - from.lng) * DEG_TO_RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
}

/**
 * Rough urban ETA used by the demo. Simple distance / average speed plus a
 * one-minute scramble buffer; the real backend will provide routing ETAs.
 */
export function etaMinutes(from: Ubicacion, to: Ubicacion, speedKmh = 28): number {
  return Math.max(1, Math.round((distanceKm(from, to) / speedKmh) * 60) + 1);
}
