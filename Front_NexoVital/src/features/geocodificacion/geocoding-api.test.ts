import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearGeocodingCache,
  formatCoordenadas,
  formatDireccion,
  parseDirecciones,
  reverseGeocode,
  searchAddress,
} from './geocoding-api';

/** A live-shaped Photon body; coordinates are GeoJSON `[lng, lat]`. */
const PHOTON_BODY = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-74.0655, 4.6486] },
      properties: {
        street: 'Carrera 7',
        housenumber: '45-10',
        district: 'Chapinero',
        city: 'Bogotá',
        country: 'Colombia',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-74.07, 4.65] },
      properties: { name: 'Parque Nacional', city: 'Bogotá' },
    },
  ],
};

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('formatDireccion', () => {
  it('writes street and number, then the neighbourhood and the city', () => {
    expect(
      formatDireccion({
        street: 'Carrera 7',
        housenumber: '45-10',
        district: 'Chapinero',
        city: 'Bogotá',
      }),
    ).toBe('Carrera 7 # 45-10, Chapinero, Bogotá');
  });

  it('falls back to the street alone when there is no house number', () => {
    expect(formatDireccion({ street: 'Calle 100', city: 'Bogotá' })).toBe('Calle 100, Bogotá');
  });

  it('prefixes a named place to its street', () => {
    expect(formatDireccion({ name: 'Hospital San Ignacio', street: 'Carrera 7' })).toBe(
      'Hospital San Ignacio, Carrera 7',
    );
  });

  it('never repeats a part', () => {
    expect(formatDireccion({ name: 'Bogotá', city: 'Bogotá' })).toBe('Bogotá');
  });

  it('is empty when the feature carries nothing readable', () => {
    expect(formatDireccion({ country: 'Colombia' })).toBe('');
  });
});

describe('parseDirecciones', () => {
  it('swaps GeoJSON [lng, lat] into { lat, lng }', () => {
    expect(parseDirecciones(PHOTON_BODY)).toEqual([
      {
        etiqueta: 'Carrera 7 # 45-10, Chapinero, Bogotá',
        ubicacion: { lat: 4.6486, lng: -74.0655 },
      },
      { etiqueta: 'Parque Nacional, Bogotá', ubicacion: { lat: 4.65, lng: -74.07 } },
    ]);
  });

  it('skips features without a label, with bad coordinates, or duplicated', () => {
    const body = {
      features: [
        { geometry: { coordinates: [-74, 4] }, properties: {} },
        { geometry: { coordinates: ['x', 4] }, properties: { name: 'Malo' } },
        { geometry: null, properties: { name: 'Sin punto' } },
        { geometry: { coordinates: [-74, 4] }, properties: { name: 'Bueno' } },
        { geometry: { coordinates: [-74.1, 4.1] }, properties: { name: 'Bueno' } },
      ],
    };
    expect(parseDirecciones(body)).toEqual([
      { etiqueta: 'Bueno', ubicacion: { lat: 4, lng: -74 } },
    ]);
  });

  it('throws on a malformed body', () => {
    expect(() => parseDirecciones(null)).toThrow();
    expect(() => parseDirecciones({})).toThrow();
  });
});

describe('searchAddress / reverseGeocode', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearGeocodingCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not call the network for a query that is too short', async () => {
    await expect(searchAddress('ca')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches inside Colombia, biased to the given point', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, PHOTON_BODY));

    const result = await searchAddress('  Carrera 7 con 45 ', {
      cerca: { lat: 4.65, lng: -74.06 },
    });

    expect(result).toHaveLength(2);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api');
    expect(url.searchParams.get('q')).toBe('Carrera 7 con 45');
    expect(url.searchParams.get('lat')).toBe('4.65');
    expect(url.searchParams.get('lon')).toBe('-74.06');
    expect(url.searchParams.get('bbox')).toBe('-79.1,-4.3,-66.8,13.5');
    // Photon rejects languages it does not index (Spanish among them).
    expect(url.searchParams.has('lang')).toBe(false);
  });

  it('rejects when the service fails', async () => {
    fetchMock.mockResolvedValue(mockResponse(503, {}));
    await expect(searchAddress('Calle 100')).rejects.toThrow('503');
  });

  it('reverse-geocodes a point and caches nearby repeats', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, PHOTON_BODY));

    await expect(reverseGeocode({ lat: 4.64861, lng: -74.06551 })).resolves.toBe(
      'Carrera 7 # 45-10, Chapinero, Bogotá',
    );
    await expect(reverseGeocode({ lat: 4.64862, lng: -74.06549 })).resolves.toBe(
      'Carrera 7 # 45-10, Chapinero, Bogotá',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe('/reverse');
    expect(url.searchParams.get('lat')).toBe('4.64861');
    expect(url.searchParams.get('lon')).toBe('-74.06551');
  });

  it('resolves null when nothing is known near the point', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { features: [] }));
    await expect(reverseGeocode({ lat: 1, lng: -70 })).resolves.toBeNull();
  });

  it('does not cache a failed reverse lookup', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(500, {}));
    fetchMock.mockResolvedValueOnce(mockResponse(200, PHOTON_BODY));

    await expect(reverseGeocode({ lat: 4.6486, lng: -74.0655 })).rejects.toThrow();
    await expect(reverseGeocode({ lat: 4.6486, lng: -74.0655 })).resolves.toContain('Carrera 7');
  });
});

describe('formatCoordenadas', () => {
  it('prints five decimals', () => {
    expect(formatCoordenadas({ lat: 4.653, lng: -74.06 })).toBe('4.65300, -74.06000');
  });
});
