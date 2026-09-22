import type { CentroAyuda, TrafficLight } from '@/types/domain';

/** Severity ranking used to pick the worst level: higher wins, neutral is 0. */
const SEVERITY: Record<TrafficLight, number> = {
  RED: 3,
  AMBER: 2,
  GREEN: 1,
  NOT_DECLARED: 0,
};

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

/**
 * Worst traffic-light level across every item of an aid center.
 *
 * A center is only as healthy as its scarcest resource, so the worst item
 * wins: RED beats AMBER beats GREEN. Items that declare no requirement
 * (NOT_DECLARED) are neutral and never raise the level, so an empty inventory —
 * or one made only of NOT_DECLARED items — stays neutral (NOT_DECLARED).
 *
 * Total: every item value, including an empty list, maps to a defined level.
 */
export function centroSemaforo(centro: CentroAyuda): TrafficLight {
  let worst: TrafficLight = 'NOT_DECLARED';
  for (const item of centro.items) {
    if (SEVERITY[item.semaforo] > SEVERITY[worst]) {
      worst = item.semaforo;
    }
  }
  return worst;
}
