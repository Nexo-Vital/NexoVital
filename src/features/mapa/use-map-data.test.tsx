import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { centerLevel, countCentersByLevel } from '@/features/ciudadano/citizen-view';
import { MOCK_CENTROS_AYUDA } from '@/mocks/fixtures';
import { DESTINATIONS, type RealtimeHandler } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { Ubicacion } from '@/types/domain';
import type { MapaResponse } from './map-api';
import { useMapData } from './use-map-data';

/** A live-shaped response: zones + centers, with NO inventory. */
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
      id: 'ORG-TIBABUYES',
      nombre: 'Acopio Tibabuyes',
      tipo: 'CENTRO_ACOPIO',
      zonaId: 'Z-SUBA',
      ubicacion: { lat: 4.73, lng: -74.1 },
    },
  ],
};

const NUEVA_UBICACION: Ubicacion = { lat: 4.75, lng: -74.05 };

const NUEVO_CONTORNO: Ubicacion[] = [
  { lat: 4.76, lng: -74.06 },
  { lat: 4.77, lng: -74.02 },
  { lat: 4.74, lng: -74.01 },
];

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

/** Counts the unsubscribe calls so the teardown can be asserted. */
class TrackingRealtimePort extends FakeRealtimePort {
  unsubscribes = 0;
  override subscribe<T>(destination: string, handler: RealtimeHandler<T>): () => void {
    const off = super.subscribe(destination, handler);
    return () => {
      this.unsubscribes += 1;
      off();
    };
  }
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
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData([], port));

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
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData([], port));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.centros.every((centro) => centro.items.length === 0)).toBe(true);
    expect(result.current.centros.map(centerLevel)).toEqual([null, null]);
    expect(countCentersByLevel(result.current.centros).notDeclared).toBe(2);
  });

  it('reports a failure without falling back to the fixtures', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, { mensaje: 'boom' }));
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData(MOCK_CENTROS_AYUDA, port));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.centros).toEqual([]);
    expect(result.current.zonas).toEqual([]);
    expect(result.current.error).not.toBeNull();
  });

  it('creates a center from a mapa.elemento.upsert with an unknown id', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData([], port));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      port.emit(DESTINATIONS.mapa, {
        type: 'mapa.elemento.upsert',
        elemento: {
          clase: 'CENTRO',
          id: 'ORG-NUEVO',
          nombre: 'Acopio Nuevo',
          zonaId: 'Z-SUBA',
          tipo: 'CENTRO_ACOPIO',
          ubicacion: NUEVA_UBICACION,
        },
      }),
    );

    expect(result.current.centros.map((centro) => centro.id)).toEqual([
      'ORG-SUBA',
      'ORG-TIBABUYES',
      'ORG-NUEVO',
    ]);
    expect(result.current.centros.find((centro) => centro.id === 'ORG-NUEVO')?.zonaId).toBe(
      'Z-SUBA',
    );
  });

  it('merges a centro upsert with a known id instead of duplicating it', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData([], port));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      port.emit(DESTINATIONS.mapa, {
        type: 'mapa.elemento.upsert',
        elemento: {
          clase: 'CENTRO',
          id: 'ORG-SUBA',
          nombre: 'Acopio Suba Renombrado',
          zonaId: 'Z-SUBA',
          tipo: 'CENTRO_ACOPIO',
          ubicacion: NUEVA_UBICACION,
        },
      }),
    );

    expect(result.current.centros).toHaveLength(2);
    expect(result.current.centros.filter((centro) => centro.id === 'ORG-SUBA')).toHaveLength(1);
    const merged = result.current.centros.find((centro) => centro.id === 'ORG-SUBA');
    expect(merged?.nombre).toBe('Acopio Suba Renombrado');
    expect(merged?.ubicacion).toEqual(NUEVA_UBICACION);
  });

  it('removes an element on mapa.elemento.delete', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData([], port));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      port.emit(DESTINATIONS.mapa, {
        type: 'mapa.elemento.delete',
        clase: 'CENTRO',
        id: 'ORG-SUBA',
      }),
    );

    expect(result.current.centros.map((centro) => centro.id)).toEqual(['ORG-TIBABUYES']);
  });

  it('a delete of one class does not touch the other class', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData([], port));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      port.emit(DESTINATIONS.mapa, {
        type: 'mapa.elemento.delete',
        clase: 'ZONA',
        id: 'Z-SUBA',
      }),
    );

    expect(result.current.zonas).toEqual([]);
    expect(result.current.centros.map((centro) => centro.id)).toEqual([
      'ORG-SUBA',
      'ORG-TIBABUYES',
    ]);
  });

  /**
   * Regression: the upsert MERGES field by field, so a frame that omits `zonaId`
   * must not erase the zone the center already had (`zoneForCentro` stops
   * resolving the opened center's zone). Writing the key as `undefined` did
   * exactly that.
   */
  it('keeps the zone of a center when a later upsert omits zonaId', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData([], port));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.centros.find((centro) => centro.id === 'ORG-SUBA')?.zonaId).toBe(
      'Z-SUBA',
    );

    act(() =>
      port.emit(DESTINATIONS.mapa, {
        type: 'mapa.elemento.upsert',
        elemento: {
          clase: 'CENTRO',
          id: 'ORG-SUBA',
          nombre: 'Acopio Suba Renombrado',
          ubicacion: NUEVA_UBICACION,
        },
      }),
    );

    const centro = result.current.centros.find((item) => item.id === 'ORG-SUBA');
    expect(centro?.nombre).toBe('Acopio Suba Renombrado');
    expect(centro?.zonaId).toBe('Z-SUBA');
  });

  it('adds a zone from a mapa.elemento.upsert with its contour', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData([], port));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      port.emit(DESTINATIONS.mapa, {
        type: 'mapa.elemento.upsert',
        elemento: {
          clase: 'ZONA',
          id: 'Z-NUEVA',
          nombre: 'Zona Nueva',
          ubicacion: NUEVA_UBICACION,
          contorno: NUEVO_CONTORNO,
        },
      }),
    );

    expect(result.current.zonas.map((zona) => zona.id)).toEqual(['Z-SUBA', 'Z-NUEVA']);
    expect(result.current.zonas.find((zona) => zona.id === 'Z-NUEVA')?.contorno).toEqual(
      NUEVO_CONTORNO,
    );
  });

  it('keeps a ZONA and a CENTRO with the same id apart (clase:id key)', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { zonas: [], centros: [] }));
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData([], port));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      port.emit(DESTINATIONS.mapa, {
        type: 'mapa.elemento.upsert',
        elemento: {
          clase: 'ZONA',
          id: 'X',
          nombre: 'Zona X',
          ubicacion: NUEVA_UBICACION,
          contorno: NUEVO_CONTORNO,
        },
      }),
    );
    act(() =>
      port.emit(DESTINATIONS.mapa, {
        type: 'mapa.elemento.upsert',
        elemento: {
          clase: 'CENTRO',
          id: 'X',
          nombre: 'Centro X',
          zonaId: 'Z-SUBA',
          tipo: 'CENTRO_ACOPIO',
          ubicacion: NUEVA_UBICACION,
        },
      }),
    );

    expect(result.current.zonas.map((zona) => zona.id)).toEqual(['X']);
    expect(result.current.centros.map((centro) => centro.id)).toEqual(['X']);
  });

  it('ignores malformed frames without breaking', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));
    const port = new FakeRealtimePort();

    const { result } = renderHook(() => useMapData([], port));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() =>
      port.emit(DESTINATIONS.mapa, { type: 'mapa.elemento.upsert', elemento: { clase: 'ZONA' } }),
    );
    act(() => port.emit(DESTINATIONS.mapa, { type: 'mapa.elemento.delete', clase: 'ZONA' }));
    act(() => port.emit(DESTINATIONS.mapa, { type: 'algo.inesperado' }));
    act(() => port.emit(DESTINATIONS.mapa, null));

    expect(result.current.centros.map((centro) => centro.id)).toEqual([
      'ORG-SUBA',
      'ORG-TIBABUYES',
    ]);
    expect(result.current.zonas.map((zona) => zona.id)).toEqual(['Z-SUBA']);
  });

  it('never subscribes in demo mode', () => {
    enableDemoMode();
    const port = new FakeRealtimePort();
    const subscribe = vi.spyOn(port, 'subscribe');

    const { result } = renderHook(() => useMapData(MOCK_CENTROS_AYUDA, port));

    expect(result.current.centros).toBe(MOCK_CENTROS_AYUDA);
    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cleans up the map subscription on unmount', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, RESPONSE));
    const port = new TrackingRealtimePort();

    const { result, unmount } = renderHook(() => useMapData([], port));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(port.unsubscribes).toBe(0);
    unmount();

    expect(port.unsubscribes).toBe(1);
  });
});
