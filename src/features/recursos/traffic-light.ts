import type { TrafficLight } from '@/types/domain';

/**
 * Traffic-light level for an inventory item.
 *
 * Thresholds: RED below 30% of the required stock, GREEN above 80%, AMBER in
 * between. When no requirement was declared (`required <= 0`) the level is
 * NOT_DECLARED. Boundaries (exactly 30% / 80%) fall into AMBER.
 */
export function trafficLight(available: number, required: number): TrafficLight {
  if (required <= 0) {
    return 'NOT_DECLARED';
  }

  const ratio = available / required;
  if (ratio < 0.3) {
    return 'RED';
  }
  if (ratio > 0.8) {
    return 'GREEN';
  }
  return 'AMBER';
}
