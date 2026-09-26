import type { Ubicacion } from '@/types/domain';

/**
 * A real street route as the map needs it.
 *
 * `geometria` is ALREADY in Leaflet order (`[lat, lng]`), never GeoJSON order:
 * the axis swap happens once, in `parseRuta`, at the service boundary.
 */
export type Ruta = {
  geometria: [number, number][];
  distanciaKm: number;
  duracionMin: number;
};

/** Public OSRM instance: HTTPS + `Access-Control-Allow-Origin: *`, no key. */
const DEFAULT_ROUTING_BASE = 'https://router.project-osrm.org';

/**
 * Upper bound for a single routing request. A slow service must never hang the
 * map: the request is aborted and the caller falls back to the straight
 * connector (AC3).
 */
export const ROUTING_TIMEOUT_MS = 8000;

/**
 * Cache granularity, in decimal places (~100 m near Bogotá). Two requests whose
 * endpoints round to the same key share one network call (AC4).
 */
const COORDINATE_DECIMALS = 3;

/** Routing service base URL, overridable at build time. */
function routingBase(): string {
  const configured = import.meta.env.VITE_ROUTING_BASE as string | undefined;
  const base = configured && configured.length > 0 ? configured : DEFAULT_ROUTING_BASE;
  return base.replace(/\/+$/, '');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Parses an OSRM `route` response into a `Ruta`.
 *
 * Throws on any non-`Ok` code, a malformed body, a missing/NaN `distance` or
 * `duration`, or a geometry with fewer than 2 coordinates. It never invents a
 * route: a failure here is what makes the caller keep the straight connector.
 */
export function parseRuta(body: unknown): Ruta {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Routing service returned a malformed body.');
  }
  const record = body as Record<string, unknown>;
  if (record.code !== 'Ok') {
    throw new Error(`Routing service did not return a route (code: ${String(record.code)}).`);
  }
  const routes = record.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error('Routing service returned no routes.');
  }
  const route = routes[0];
  if (typeof route !== 'object' || route === null) {
    throw new Error('Routing service returned a malformed route.');
  }
  const routeRecord = route as Record<string, unknown>;

  const geometry = routeRecord.geometry;
  const coordinates =
    typeof geometry === 'object' && geometry !== null
      ? (geometry as Record<string, unknown>).coordinates
      : undefined;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error('Routing service returned a route with fewer than 2 points.');
  }

  const geometria: [number, number][] = coordinates.map((point) => {
    if (
      !Array.isArray(point) ||
      point.length < 2 ||
      !isFiniteNumber(point[0]) ||
      !isFiniteNumber(point[1])
    ) {
      throw new Error('Routing service returned a malformed coordinate.');
    }
    // GeoJSON is [lng, lat]; Leaflet needs [lat, lng]. Swapping here is the
    // whole contract: without it the route lands in the wrong hemisphere (FD-3).
    return [point[1], point[0]];
  });

  const distance = routeRecord.distance;
  const duration = routeRecord.duration;
  if (!isFiniteNumber(distance) || !isFiniteNumber(duration)) {
    throw new Error('Routing service returned a route without a distance or duration.');
  }

  return {
    geometria,
    // OSRM reports meters and seconds; the front speaks km and minutes.
    distanciaKm: distance / 1000,
    duracionMin: duration / 60,
  };
}

/** Builds the OSRM driving URL. OSRM takes `lng,lat`, NOT `lat,lng`. */
function buildUrl(origen: Ubicacion, destino: Ubicacion): string {
  const from = `${origen.lng},${origen.lat}`;
  const to = `${destino.lng},${destino.lat}`;
  return `${routingBase()}/route/v1/driving/${from};${to}?overview=full&geometries=geojson&steps=false`;
}

/** Resolved routes, keyed by rounded endpoints. */
const cache = new Map<string, Ruta>();
/** Requests in flight, so two identical lookups share ONE network call (AC4). */
const inFlight = new Map<string, Promise<Ruta>>();

function cacheKey(origen: Ubicacion, destino: Ubicacion): string {
  return `${origen.lat.toFixed(COORDINATE_DECIMALS)},${origen.lng.toFixed(COORDINATE_DECIMALS)};${destino.lat.toFixed(COORDINATE_DECIMALS)},${destino.lng.toFixed(COORDINATE_DECIMALS)}`;
}

/**
 * One plain `fetch`, deliberately NOT `apiFetch`: the routing service is a third
 * party, so a 401 from it must never trigger the app's logout + redirect
 * (FD-2). This function never touches the session, localStorage or the realtime
 * channel.
 */
async function requestRuta(origen: Ubicacion, destino: Ubicacion): Promise<Ruta> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROUTING_TIMEOUT_MS);
  try {
    const response = await fetch(buildUrl(origen, destino), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Routing service responded with status ${response.status}.`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('Routing service returned a body that is not JSON.');
    }
    return parseRuta(body);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolves the real street route between two points. Repeat calls for endpoints
 * that round to the same ~100 m cell are served from the cache, and concurrent
 * identical calls share one request.
 */
export function fetchRuta(origen: Ubicacion, destino: Ubicacion): Promise<Ruta> {
  const key = cacheKey(origen, destino);
  const cached = cache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const request = requestRuta(origen, destino)
    .then((ruta) => {
      cache.set(key, ruta);
      return ruta;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

/** Test seam: drops both the resolved cache and the in-flight registry. */
export function clearRutaCache(): void {
  cache.clear();
  inFlight.clear();
}
