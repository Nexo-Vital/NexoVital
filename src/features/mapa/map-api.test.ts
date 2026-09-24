import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { centerLevel, countCentersByLevel } from '@/features/ciudadano/citizen-view';
import { centroSemaforo } from '@/features/recursos/traffic-light';
import { setToken } from '@/services/apiClient';
import { fetchMapa, type MapaResponse, mapaToCentros } from './map-api';

/** A live-shaped response: 2 zones and 3 Bogotá centers, with NO inventory. */
const RESPONSE: MapaResponse = {
  zonas: [
    {
      id: 'Z-SUBA',
      nombre: 'Suba',
      ubicacion: { lat: 4.742, lng: -74.09 },
      contorno: [
        { lat: 4.79, lng: -74.1 },
        { lat: 4.795, lng: -74.05 },
        { lat: 4.755, lng: -74.032 },
        { lat: 4.7, lng: -74.05 },
      ],
    },
    {
      id: 'Z-KENNEDY',
      nombre: 'Kennedy',
      ubicacion: { lat: 4.628, lng: -74.148 },
      contorno: [
        { lat: 4.665, lng: -74.16 },
        { lat: 4.66, lng: -74.115 },
        { lat: 4.6, lng: -74.105 },
        { lat: 4.575, lng: -74.135 },
      ],
    },
  ],
  centros: [
    {
      id: 'ORG-SUBA',
      nombre: 'Acopio Suba Norte',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.742, lng: -74.09 },
    },
    {
      id: 'ORG-GAITANA',
      nombre: 'Acopio La Gaitana',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.72, lng: -74.05 },
    },
    {
      id: 'ORG-TIBABUYES',
      nombre: 'Acopio Tibabuyes',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.73, lng: -74.1 },
    },
  ],
};

/** Minimal Response stand-in: apiFetch only reads status, ok, headers.get, json. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('mapaToCentros', () => {
  it('maps the backend centers onto the front domain with their real location', () => {
    const centros = mapaToCentros(RESPONSE);

    expect(centros).toHaveLength(3);
    expect(centros[0]).toEqual({
      id: 'ORG-SUBA',
      nombre: 'Acopio Suba Norte',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.742, lng: -74.09 },
      items: [],
    });
  });

  it('keeps the backend zonaId so the map can resolve the center zone', () => {
    const centros = mapaToCentros(RESPONSE);

    // Dropping it was the bug: the map needs it to show the opened center's zone.
    expect(centros.map((centro) => centro.zonaId)).toEqual(['Z-SUBA', 'Z-SUBA', 'Z-SUBA']);
  });

  it('declares no inventory: every backend center is NOT_DECLARED, never a faked light', () => {
    const centros = mapaToCentros(RESPONSE);

    for (const centro of centros) {
      expect(centro.items).toEqual([]);
      expect(centroSemaforo(centro)).toBe('NOT_DECLARED');
      expect(centerLevel(centro)).toBeNull();
    }
    expect(countCentersByLevel(centros)).toEqual({
      stable: 0,
      alert: 0,
      critical: 0,
      notDeclared: 3,
    });
  });
});

describe('fetchMapa', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('requests /api/v1/mapa with the persisted Bearer token', async () => {
    setToken('jwt.test');
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));

    await expect(fetchMapa()).resolves.toEqual(RESPONSE);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/mapa',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );
  });

  it('surfaces a backend failure as an ApiError instead of inventing data', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, { mensaje: 'boom' }));

    await expect(fetchMapa()).rejects.toMatchObject({ status: 500 });
  });
});
