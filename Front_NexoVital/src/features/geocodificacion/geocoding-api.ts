import type { Ubicacion } from '@/types/domain';

/**
 * Address lookup for the citizen report (EP-02.F1.US3), in both directions:
 *
 * - `searchAddress`: text the citizen types -> candidate places with coordinates.
 * - `reverseGeocode`: coordinates (the device GPS) -> the nearest known address.
 *
 * Both go to Photon (komoot), an OpenStreetMap geocoder with CORS and no API
 * key. The result is APPROXIMATE by nature: OSM rarely carries exact house
 * numbers in Bogotá, so the answer is usually the street or the neighbourhood.
 * The coordinates stay the source of truth; the address is only how a person
 * reads them. That is why every failure here is non-blocking for the caller.
 */

/** Public Photon instance: HTTPS + CORS, no key, fair-use. */
const DEFAULT_GEOCODING_BASE = 'https://photon.komoot.io';

/** A slow geocoder must never hang the dialog: the request is aborted. */
export const GEOCODING_TIMEOUT_MS = 6000;

/** Shortest text worth a network call; below it the search resolves to `[]`. */
export const MIN_ADDRESS_QUERY = 3;

/** Suggestions requested per search. */
const SEARCH_LIMIT = 5;

/**
 * Reverse-cache granularity, in decimal places (~11 m). A GPS fix that jitters a
 * few metres resolves to the same address without a second request.
 */
const COORDINATE_DECIMALS = 4;

/**
 * Colombia's bounding box (`minLon,minLat,maxLon,maxLat`). The search is limited
 * to it so "Calle 100" never answers with a street in another country.
 */
const COLOMBIA_BBOX = '-79.1,-4.3,-66.8,13.5';

/** One place the citizen can pick. */
export type DireccionSugerida = {
  /** Readable address, e.g. "Carrera 7 # 45-10, Chapinero, Bogotá". */
  etiqueta: string;
  ubicacion: Ubicacion;
};

function geocodingBase(): string {
  const configured = import.meta.env.VITE_GEOCODING_BASE as string | undefined;
  const base = configured && configured.length > 0 ? configured : DEFAULT_GEOCODING_BASE;
  return base.replace(/\/+$/, '');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Builds the readable label of a Photon feature from its OSM properties.
 *
 * The first part is the most specific thing known (street + number, else the
 * place name, else the street alone); the rest is the neighbourhood and the
 * city. Repeated parts are dropped, so a feature whose name equals its city does
 * not read "Bogotá, Bogotá". Returns `''` when nothing usable is present.
 */
export function formatDireccion(properties: Record<string, unknown>): string {
  const street = text(properties.street);
  const houseNumber = text(properties.housenumber);
  const name = text(properties.name);

  let principal = name || street;
  if (street && houseNumber) {
    principal = `${street} # ${houseNumber}`;
  } else if (name && street && name !== street) {
    principal = `${name}, ${street}`;
  }

  const parts = [
    principal,
    text(properties.district) || text(properties.locality),
    text(properties.city) || text(properties.county),
  ];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts.flatMap((value) => value.split(', '))) {
    const key = part.toLowerCase();
    if (part && !seen.has(key)) {
      seen.add(key);
      unique.push(part);
    }
  }
  return unique.join(', ');
}

/**
 * Parses a Photon GeoJSON `FeatureCollection`. Features without a usable label
 * or with malformed coordinates are skipped, never invented.
 */
export function parseDirecciones(body: unknown): DireccionSugerida[] {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Geocoding service returned a malformed body.');
  }
  const features = (body as Record<string, unknown>).features;
  if (!Array.isArray(features)) {
    throw new Error('Geocoding service returned no feature list.');
  }
  const result: DireccionSugerida[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    if (typeof feature !== 'object' || feature === null) {
      continue;
    }
    const record = feature as Record<string, unknown>;
    const geometry = record.geometry as Record<string, unknown> | null | undefined;
    const coordinates = geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      continue;
    }
    // GeoJSON is [lng, lat]; the app speaks { lat, lng }.
    const [lng, lat] = coordinates as unknown[];
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      continue;
    }
    const properties =
      typeof record.properties === 'object' && record.properties !== null
        ? (record.properties as Record<string, unknown>)
        : {};
    const etiqueta = formatDireccion(properties);
    if (!etiqueta || seen.has(etiqueta)) {
      continue;
    }
    seen.add(etiqueta);
    result.push({ etiqueta, ubicacion: { lat, lng } });
  }
  return result;
}

/**
 * One plain `fetch`, deliberately NOT `apiFetch`: the geocoder is a third party,
 * so it must never receive the app's token nor trigger its logout on a 401.
 * `external` lets the caller cancel a superseded type-ahead request.
 */
async function requestDirecciones(
  url: string,
  external?: AbortSignal,
): Promise<DireccionSugerida[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEOCODING_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  external?.addEventListener('abort', onExternalAbort);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Geocoding service responded with status ${response.status}.`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('Geocoding service returned a body that is not JSON.');
    }
    return parseDirecciones(body);
  } finally {
    clearTimeout(timeoutId);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Searches places matching what the citizen typed. `cerca` biases the ranking
 * towards that point (the citizen's side of the city) without excluding the
 * rest. A query shorter than `MIN_ADDRESS_QUERY` resolves to `[]` with no
 * network call.
 */
export function searchAddress(
  query: string,
  options: { cerca?: Ubicacion; signal?: AbortSignal } = {},
): Promise<DireccionSugerida[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_ADDRESS_QUERY) {
    return Promise.resolve([]);
  }
  const params = new URLSearchParams({
    q: trimmed,
    limit: String(SEARCH_LIMIT),
    bbox: COLOMBIA_BBOX,
  });
  if (options.cerca) {
    params.set('lat', String(options.cerca.lat));
    params.set('lon', String(options.cerca.lng));
  }
  return requestDirecciones(`${geocodingBase()}/api?${params.toString()}`, options.signal);
}

/** Resolved reverse lookups, keyed by rounded coordinates. `null` = no address. */
const reverseCache = new Map<string, string | null>();

/**
 * Resolves the approximate address of a point, or `null` when the geocoder knows
 * nothing near it. Rejects when the service fails; the caller then shows the
 * coordinates instead (see `formatCoordenadas`).
 */
export async function reverseGeocode(ubicacion: Ubicacion): Promise<string | null> {
  const key = `${ubicacion.lat.toFixed(COORDINATE_DECIMALS)},${ubicacion.lng.toFixed(COORDINATE_DECIMALS)}`;
  if (reverseCache.has(key)) {
    return reverseCache.get(key) ?? null;
  }
  const params = new URLSearchParams({
    lat: String(ubicacion.lat),
    lon: String(ubicacion.lng),
    limit: '1',
  });
  const found = await requestDirecciones(`${geocodingBase()}/reverse?${params.toString()}`);
  const etiqueta = found[0]?.etiqueta ?? null;
  reverseCache.set(key, etiqueta);
  return etiqueta;
}

/** Coordinates as readable text: the fallback when there is no address. */
export function formatCoordenadas(ubicacion: Ubicacion): string {
  return `${ubicacion.lat.toFixed(5)}, ${ubicacion.lng.toFixed(5)}`;
}

/** Test seam: drops the reverse-lookup cache. */
export function clearGeocodingCache(): void {
  reverseCache.clear();
}
