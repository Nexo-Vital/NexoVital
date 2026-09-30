import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRutaCache, fetchRuta, parseRuta } from './routing-api';

/**
 * A live-shaped OSRM body. The coordinates are deliberately `[lng, lat]` order:
 * they are the exact shape that must be swapped before Leaflet sees them.
 */
const LIVE_RESPONSE = {
  code: 'Ok',
  routes: [
    {
      distance: 4512,
      duration: 484,
      geometry: {
        type: 'LineString',
        coordinates: [
          [-74.078, 4.728],
          [-74.0775, 4.7285],
          [-74.077, 4.729],
        ],
      },
    },
  ],
  waypoints: [],
};

const ORIGEN = { lat: 4.728, lng: -74.078 };
const DESTINO = { lat: 4.729, lng: -74.077 };

/** Minimal Response stand-in: the client only reads `ok`, `status` and `json`. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('parseRuta', () => {
  it('swaps GeoJSON [lng, lat] into Leaflet [lat, lng] (FD-3)', () => {
    const ruta = parseRuta(LIVE_RESPONSE);

    expect(ruta.geometria[0]).toEqual([4.728, -74.078]);
    expect(ruta.geometria[2]).toEqual([4.729, -74.077]);
    // If the swap were missing, the first point would still be [-74.078, 4.728].
    expect(ruta.geometria).not.toContainEqual([-74.078, 4.728]);
  });

  it('converts distance from meters to kilometers', () => {
    expect(parseRuta(LIVE_RESPONSE).distanciaKm).toBeCloseTo(4.512, 6);
  });

  it('converts duration from seconds to minutes', () => {
    expect(parseRuta(LIVE_RESPONSE).duracionMin).toBeCloseTo(484 / 60, 6);
  });

  it('throws on a non-Ok code instead of inventing a route', () => {
    expect(() => parseRuta({ code: 'NoRoute', routes: [] })).toThrow(/code: NoRoute/);
  });

  it('throws when the geometry has fewer than 2 coordinates', () => {
    expect(() =>
      parseRuta({
        code: 'Ok',
        routes: [{ distance: 1, duration: 1, geometry: { coordinates: [[-74.078, 4.728]] } }],
      }),
    ).toThrow(/fewer than 2 points/);
  });

  it('throws on a malformed body', () => {
    expect(() => parseRuta('not-json')).toThrow(/malformed body/);
    expect(() => parseRuta(null)).toThrow(/malformed body/);
  });

  it('throws when the route carries no numeric distance or duration', () => {
    expect(() =>
      parseRuta({
        code: 'Ok',
        routes: [
          {
            distance: 'far',
            duration: 1,
            geometry: {
              coordinates: [
                [-74.078, 4.728],
                [-74.077, 4.729],
              ],
            },
          },
        ],
      }),
    ).toThrow(/without a distance or duration/);
  });
});

describe('fetchRuta', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearRutaCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearRutaCache();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('builds the OSRM driving URL with lng,lat axis order', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, LIVE_RESPONSE));

    await fetchRuta(ORIGEN, DESTINO);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://router.project-osrm.org/route/v1/driving/-74.078,4.728;-74.077,4.729?overview=full&geometries=geojson&steps=false',
    );
  });

  it('honours VITE_ROUTING_BASE when it is set', async () => {
    vi.stubEnv('VITE_ROUTING_BASE', 'https://routing.example.test/');
    fetchMock.mockResolvedValue(mockResponse(200, LIVE_RESPONSE));

    await fetchRuta(ORIGEN, DESTINO);

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'https://routing.example.test/route/v1/driving/',
    );
  });

  it('rejects on a non-2xx status so the caller can fall back', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, { code: 'Error' }));

    await expect(fetchRuta(ORIGEN, DESTINO)).rejects.toThrow(/status 500/);
  });

  it('serves two identical calls from one network request (AC4)', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, LIVE_RESPONSE));

    const [first, second] = await Promise.all([
      fetchRuta(ORIGEN, DESTINO),
      fetchRuta(ORIGEN, DESTINO),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);

    // A later call with the same rounded endpoints is cached, still one request.
    const third = await fetchRuta(ORIGEN, DESTINO);
    expect(third).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts a slow request after the timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );

    const request = fetchRuta(ORIGEN, DESTINO);
    const assertion = expect(request).rejects.toThrow(/aborted/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });
});
