import { apiFetch } from '@/services/apiClient';
import type { AlertaEscasez, CentroAyuda, TipoCentroAyuda, Ubicacion, Zona } from '@/types/domain';

/**
 * Aid center exactly as `GET /api/v1/mapa` returns it (verified live): identity,
 * name, type, zone and location. It carries NO inventory — that belongs to the
 * `recursos` module (EP-03) — but it DOES carry the center's worst active
 * shortage alert and the number of active alerts (EP-03.F1.US5).
 */
export interface MapaCentroDto {
  id: string;
  nombre: string;
  tipo: string;
  /**
   * Belongs to a zone by id. Optional AND nullable: an organization may be
   * registered with no zone (the OpenAPI request does not require it) and the
   * backend column is nullable, so both the REST snapshot and a realtime frame
   * can carry `null`.
   */
  zonaId?: string | null;
  ubicacion: Ubicacion;
  /**
   * Worst active shortage alert of the center, if any. Optional AND nullable:
   * the backend omits it when the center has none (`@JsonInclude(NON_NULL)`,
   * verified in `CentroDto.java`), but a realtime frame or another client can
   * still send an explicit `null`, so both must collapse to "no key".
   */
  alerta?: AlertaEscasez | null;
  /**
   * Number of active shortage alerts of the center. Optional: the map read-model
   * exposes it as `alertasActivas`, but a payload that does not carry it must
   * degrade to today's behaviour.
   */
  alertasActivas?: number;
}

/** Body of `GET /api/v1/mapa`: active zones and aid centers with their location. */
export interface MapaResponse {
  zonas: Zona[];
  centros: MapaCentroDto[];
}

/** Reads the map read-model. `apiFetch` attaches the Bearer token. */
export function fetchMapa(): Promise<MapaResponse> {
  return apiFetch<MapaResponse>('/mapa');
}

/**
 * Keeps a WIRE `tipo` the front understands, or `undefined` when it is absent
 * or unknown. The known set is the contract's `TipoOrganizacion`
 * (`CENTRO_AYUDA`, `CENTRO_ACOPIO`) plus the FRONT-ONLY demo value `HOSPITAL`
 * (see `TipoCentroAyuda`). Anything else is refused here so a rogue wire value
 * can never reach the domain: it degrades to today's behavior (AC4) instead of
 * being trusted, and it can never be mistaken for a hospital.
 */
function toTipoCentroAyuda(value: string | null | undefined): TipoCentroAyuda | undefined {
  if (value === 'CENTRO_AYUDA' || value === 'CENTRO_ACOPIO' || value === 'HOSPITAL') {
    return value;
  }
  return undefined;
}

/**
 * Maps the backend's centers onto the front's `CentroAyuda`.
 *
 * `items` is ALWAYS empty because the endpoint returns no inventory: inventing
 * one (or a traffic light) would be a lie. An empty inventory derives
 * NOT_DECLARED through `centroSemaforo`, so a backend center honestly shows as
 * "sin declarar" until `recursos` (EP-03) exists. `tipo` IS carried now (AC3):
 * it was previously dropped at this boundary even though the wire always sent
 * it. `zonaId` IS preserved: it is how a center resolves its zone
 * (`zoneForCentro`). The citizen map does not currently paint that zone on
 * selection (U2), but dropping the id here would erase a real backend link.
 */
export function mapaToCentros(mapa: MapaResponse): CentroAyuda[] {
  return mapa.centros.map((centro) => {
    const tipo = toTipoCentroAyuda(centro.tipo);
    return {
      id: centro.id,
      nombre: centro.nombre,
      // `tipo` is OMITTED when absent or unknown, never written as
      // `tipo: undefined`: the realtime upsert MERGES an element field by field
      // (design D4), so a present-but-undefined key would ERASE the type a
      // center already had — the same failure the `zonaId` guard prevents.
      ...(tipo === undefined ? {} : { tipo }),
      // An absent zone is OMITTED, never written as a present-but-nullish key:
      // the realtime upsert MERGES an element field by field (design D4), and a
      // `zonaId: undefined`/`null` would ERASE the zone a center already had,
      // breaking `zoneForCentro`. The wire sends JSON `null` (not `undefined`)
      // for a center without a zone, and the REST path can too now that the
      // backend column is nullable, so BOTH must collapse to "no key".
      ...(centro.zonaId == null ? {} : { zonaId: centro.zonaId }),
      // The alert is OMITTED when absent or `null`, never written as
      // `alerta: null`: the same merge rule as `tipo`/`zonaId` (design D4) — a
      // present-but-nullish key would ERASE an alert the center already had.
      ...(centro.alerta == null ? {} : { alerta: centro.alerta }),
      // Same rule for the count: an absent key must not overwrite a known one.
      ...(centro.alertasActivas == null ? {} : { alertasActivas: centro.alertasActivas }),
      ubicacion: centro.ubicacion,
      items: [],
    };
  });
}
