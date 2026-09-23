import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { centerLevel, countCentersByLevel } from '@/features/ciudadano/citizen-view';
import { MOCK_CENTROS_AYUDA } from '@/mocks/fixtures';
import type { MapaResponse } from './map-api';
import { useMapData } from './use-map-data';

/** A live-shaped response: zones + centers, with NO inventory. */
const RESPONSE: MapaResponse = {
  zonas: [{ id: 'Z-SUBA', nombre: 'Suba', ubicacion: { lat: 4.742, lng: -74.09 } }],
  centros: [
    {
      id: 'ORG-SUBA',
      nombre: 'Acopio Suba Norte',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.742, lng: -74.09 },
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

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

/** Turns on the build-time flag for a single case. */
function enableDemoMode(): void {
  vi.stubEnv('VITE_DEMO_MODE', '1');
}

describe('useMapData', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    // The flag is unset by default: every other suite keeps the real path.
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('uses the fixtures with the demo flag active and never touches the network', () => {
    enableDemoMode();

    const { result } = renderHook(() => useMapData(MOCK_CENTROS_AYUDA));

    expect(result.current.centros).toBe(MOCK_CENTROS_AYUDA);
    expect(result.current.zonas).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests /api/v1/mapa without the flag and maps zones and centers', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));

    const { result } = renderHook(() => useMapData([]));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.centros.map((centro) => centro.id)).toEqual([
      'ORG-SUBA',
      'ORG-TIBABUYES',
    ]);
    expect(result.current.zonas).toEqual(RESPONSE.zonas);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/mapa', expect.anything());
  });

  it('shows backend centers as undeclared: no inventory or light is invented', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));

    const { result } = renderHook(() => useMapData([]));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.centros.every((centro) => centro.items.length === 0)).toBe(true);
    expect(result.current.centros.map(centerLevel)).toEqual([null, null]);
    expect(countCentersByLevel(result.current.centros).notDeclared).toBe(2);
  });

  it('reports a failure without falling back to the fixtures', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, { mensaje: 'boom' }));

    const { result } = renderHook(() => useMapData(MOCK_CENTROS_AYUDA));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.centros).toEqual([]);
    expect(result.current.zonas).toEqual([]);
    expect(result.current.error).not.toBeNull();
  });
});
