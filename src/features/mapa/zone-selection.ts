import type { CentroAyuda, Zona } from '@/types/domain';

/**
 * The zone a center belongs to, for the map's "show the zone of the center you
 * opened" rule.
 *
 * The backend groups each center under a zone by id (`zonaId`) and the same
 * payload carries the zones with that id, so one is resolved from the other.
 * Returns null when the center declares no zone (the demo fixtures) or the zone
 * list has no match, so a missing link draws nothing instead of a wrong pin.
 * Zones are NEVER drawn on their own: the mockup's map has none, and only an
 * opened center reveals its own.
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

/**
 * The polygon positions of a zone's contour, ready for Leaflet.
 *
 * `Zona.contorno` is the ordered list of vertices that encloses the zone, so
 * mapping it is what turns the zone into a paintable AREA. A contour with fewer
 * than three vertices cannot enclose any area, and a missing contour means the
 * data carries no geometry at all: both return null so the map paints nothing
 * instead of an invented footprint or a degenerate line.
 */
export function zoneAreaPositions(zona: Zona | null | undefined): [number, number][] | null {
  const contorno = zona?.contorno;
  if (!contorno || contorno.length < 3) {
    return null;
  }
  return contorno.map((vertice) => [vertice.lat, vertice.lng]);
}
