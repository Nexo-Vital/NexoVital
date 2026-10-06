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
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.742, lng: -74.09 },
      items: [],
    });
  });

  it('AC3: carries the wire tipo through instead of dropping it', () => {
    const centros = mapaToCentros(RESPONSE);

    // Regression: the mapper used to discard `tipo`, even though the wire
    // always sent it. The domain now receives it.
    expect(centros.map((centro) => centro.tipo)).toEqual([
      'CENTRO_ACOPIO',
      'CENTRO_ACOPIO',
      'CENTRO_ACOPIO',
    ]);
  });

  it('carries the FRONT-ONLY HOSPITAL tipo through (demo value, not contract)', () => {
    const centros = mapaToCentros({
      zonas: [],
      centros: [
        {
          id: 'H-1',
          nombre: 'Hospital Demo',
          tipo: 'HOSPITAL',
          ubicacion: { lat: 4.7, lng: -74.06 },
        },
      ],
    });

    expect(centros[0].tipo).toBe('HOSPITAL');
  });

  it('AC4: an absent or unknown tipo is dropped, never guessed and never a hospital', () => {
    const centros = mapaToCentros({
      zonas: [],
      centros: [
        {
          id: 'SIN-TIPO',
          nombre: 'Acopio sin tipo',
          tipo: undefined as unknown as string,
          ubicacion: { lat: 4.7, lng: -74.06 },
        },
        {
          id: 'TIPO-RARO',
          nombre: 'Acopio tipo raro',
          tipo: 'CLINICA',
          ubicacion: { lat: 4.71, lng: -74.07 },
        },
      ],
    });

    // The key is OMITTED, never `tipo: undefined`: the realtime merge would
    // otherwise erase a type the center already had (same rule as `zonaId`).
    expect('tipo' in centros[0]).toBe(false);
    expect(centros[0].tipo).toBeUndefined();
    expect(centros[1].tipo).toBeUndefined();
    // An unknown value can never silently become a hospital.
    expect(centros.map((centro) => centro.tipo)).not.toContain('HOSPITAL');
  });

  it('keeps the backend zonaId so the map can resolve the center zone', () => {
    const centros = mapaToCentros(RESPONSE);

    // Dropping it was the bug: the map needs it to show the opened center's zone.
    expect(centros.map((centro) => centro.zonaId)).toEqual(['Z-SUBA', 'Z-SUBA', 'Z-SUBA']);
  });

  it('EP-03.F1.US5: carries the worst active alert and the count through, verbatim', () => {
    const AGUA = {
      itemId: 'INV-1',
      nombre: 'Agua potable',
      requerido: 8,
      disponible: 5,
      faltante: 3,
    };
    const COBIJAS = {
      itemId: 'INV-2',
      nombre: 'Cobijas',
      requerido: 4,
      disponible: 3,
      faltante: 1,
    };
    const centros = mapaToCentros({
      zonas: [],
      centros: [
        {
          id: 'ORG-ALERTA',
          nombre: 'Acopio Alerta',
          tipo: 'CENTRO_ACOPIO',
          ubicacion: { lat: 4.7, lng: -74.06 },
          alerta: AGUA,
          alertasActivas: 2,
          alertas: [AGUA, COBIJAS],
        },
      ],
    });

    // Field names mirror the contract `AlertaEscasez` byte-for-byte.
    expect(centros[0].alerta).toEqual({
      itemId: 'INV-1',
      nombre: 'Agua potable',
      requerido: 8,
      disponible: 5,
      faltante: 3,
    });
    expect(centros[0].alertasActivas).toBe(2);
    // EP-03.F3.US4: every resource the center is missing travels with it.
    expect(centros[0].alertas).toEqual([AGUA, COBIJAS]);
  });

  it('EP-03.F1.US5: an absent or null alert is OMITTED, never a present-but-nullish key', () => {
    const centros = mapaToCentros({
      zonas: [],
      centros: [
        {
          id: 'SIN-ALERTA',
          nombre: 'Acopio sin alerta',
          tipo: 'CENTRO_ACOPIO',
          ubicacion: { lat: 4.7, lng: -74.06 },
        },
        {
          id: 'ALERTA-NULL',
          nombre: 'Acopio alerta nula',
          tipo: 'CENTRO_ACOPIO',
          ubicacion: { lat: 4.71, lng: -74.07 },
          alerta: null,
        },
      ],
    });

    // The realtime merge would otherwise erase an alert the center already had
    // (same rule as `tipo`/`zonaId`): both must collapse to "no key".
    for (const centro of centros) {
      expect('alerta' in centro).toBe(false);
      expect('alertasActivas' in centro).toBe(false);
    }
  });

  it('declares no inventory: every backend center is NOT_DECLARED, never a faked light', () => {
    const centros = mapaToCentros(RESPONSE);

    for (const centro of centros) {
      expect(centro.items).toEqual([]);
      expect(centroSemaforo(centro)).toBe('NOT_DECLARED');
      expect(centerLevel(centro)).toBeNull();
    }
    expect(countCentersByLevel(centros)).toEqual({
      complete: 0,
      stable: 0,
      alert: 0,
      critical: 0,
      notDeclared: 3,
      hospitals: 0,
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
