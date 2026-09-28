import type { CentroAyuda, Zona } from '@/types/domain';

/**
 * The zone a center belongs to, for on-demand zone resolution.
 *
 * The backend groups each center under a zone by id (`zonaId`) and the same
 * payload carries the zones with that id, so one is resolved from the other.
 * Returns null when the center declares no zone (the demo fixtures) or the zone
 * list has no match, so a missing link resolves to nothing instead of a wrong
 * pin. Zones are NEVER painted on the map: "zonas afectadas" are point reports
 * (a single incident), not areas drawn over the city.
 */
export function zoneForCentro(
  zonas: readonly Zona[],
  centro: CentroAyuda | null | undefined,
): Zona | null {
  if (!centro?.zonaId) {
    return null;
  }
  return zonas.find((zona) => zona.id === centro.zonaId) ?? null;
}
