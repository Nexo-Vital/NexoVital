import type { CentroAyuda, TrafficLight } from '@/types/domain';

/** Severity ranking used to pick the worst level: higher wins, neutral is 0. */
const SEVERITY: Record<TrafficLight, number> = {
  RED: 4,
  AMBER: 3,
  GREEN: 2,
  COMPLETE: 1,
  NOT_DECLARED: 0,
};

/**
 * Traffic-light level for an inventory item (EP-02.F2.US1). Mirrors the
 * backend rule (`ItemInventario.semaforo()`) with the same integer math:
 *
 * - COMPLETE: available >= required, or no requirement declared;
 * - RED: below 35% of the required stock;
 * - AMBER: 35% (inclusive) to below 70%;
 * - GREEN: 70% (inclusive) to below 100%.
 */
export function trafficLight(available: number, required: number): TrafficLight {
  if (required <= 0 || available >= required) {
    return 'COMPLETE';
  }
  if (available * 100 < required * 35) {
    return 'RED';
  }
  if (available * 100 < required * 70) {
    return 'AMBER';
  }
  return 'GREEN';
}

/**
 * Worst traffic-light level across every item of an aid center.
 *
 * A center is only as healthy as its scarcest resource, so the worst item
 * wins: RED beats AMBER beats GREEN beats COMPLETE. An empty inventory that was
 * already READ means the center has nothing and needs nothing, so it is
 * COMPLETE; one that was not read yet stays neutral (NOT_DECLARED).
 *
 * Total: every item value, including an empty list, maps to a defined level.
 */
export function centroSemaforo(centro: CentroAyuda): TrafficLight {
  if (centro.items.length === 0 && centro.inventarioCargado) {
    return 'COMPLETE';
  }
  let worst: TrafficLight = 'NOT_DECLARED';
  for (const item of centro.items) {
    if (SEVERITY[item.semaforo] > SEVERITY[worst]) {
      worst = item.semaforo;
    }
  }
  return worst;
}
