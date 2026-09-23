import { apiFetch } from '@/services/apiClient';
import type { CentroAyuda, Ubicacion, Zona } from '@/types/domain';

/**
 * Aid center exactly as `GET /api/v1/mapa` returns it (verified live): identity,
 * name, type, zone and location, and NOTHING else. The endpoint carries no
 * inventory — that belongs to the `recursos` module (EP-03), which does not
 * exist yet — so `tipo` and `zonaId` are the only fields the front domain has no
 * slot for (see `mapaToCentros`).
 */
export interface MapaCentroDto {
  id: string;
  nombre: string;
  tipo: string;
  zonaId: string;
  ubicacion: Ubicacion;
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
 * Maps the backend's centers onto the front's `CentroAyuda`.
 *
 * `items` is ALWAYS empty because the endpoint returns no inventory: inventing
 * one (or a traffic light) would be a lie. An empty inventory derives
 * NOT_DECLARED through `centroSemaforo`, so a backend center honestly shows as
 * "sin declarar" until `recursos` (EP-03) exists. `tipo` and `zonaId` are
 * dropped because `CentroAyuda` has no slot for them; preserving them is a
 * follow-up, not something to fake here.
 */
export function mapaToCentros(mapa: MapaResponse): CentroAyuda[] {
  return mapa.centros.map((centro) => ({
    id: centro.id,
    nombre: centro.nombre,
    ubicacion: centro.ubicacion,
    items: [],
  }));
}
