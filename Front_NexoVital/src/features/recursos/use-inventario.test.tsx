import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_CENTROS_AYUDA } from '@/mocks/fixtures';
import { setToken } from '@/services/apiClient';
import { DESTINATIONS } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { CentroAyuda } from '@/types/domain';
import { useInventarioStore } from './inventory-store';
import { useInventario } from './use-inventario';

const CENTROS: CentroAyuda[] = [
  { id: 'c-1', nombre: 'Centro 1', ubicacion: { lat: 0, lng: 0 }, items: [] },
  { id: 'c-2', nombre: 'Centro 2', ubicacion: { lat: 0, lng: 0 }, items: [] },
];

/** A live-shaped wire item for a given center. */
function dto(centroId: string, id: string, semaforo: string, disponible: number) {
  return {
    id,
    centroAcopioId: centroId,
    nombre: `Item ${id}`,
    disponible,
    requerido: 100,
    semaforo,
  };
}

/** Minimal Response stand-in: apiFetch only reads status, ok, headers.get, json. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('useInventario', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useInventarioStore.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
    useInventarioStore.getState().reset();
  });

  it('loads every center inventory and merges it into the store', async () => {
    setToken('jwt.test');
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/centros-acopio/c-1/inventario')) {
        return Promise.resolve(mockResponse(200, [dto('c-1', 'i-1', 'ROJO', 12)]));
      }
      if (url.endsWith('/centros-acopio/c-2/inventario')) {
        return Promise.resolve(mockResponse(200, [dto('c-2', 'i-2', 'VERDE', 90)]));
      }
      return Promise.resolve(mockResponse(404, {}));
    });

    renderHook(() => useInventario(CENTROS, new FakeRealtimePort()));

    await waitFor(() =>
      expect(useInventarioStore.getState().itemsByCentro['c-1']?.[0]?.semaforo).toBe('RED'),
    );
    expect(useInventarioStore.getState().itemsByCentro['c-2']?.[0]?.semaforo).toBe('GREEN');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/centros-acopio/c-1/inventario',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );
  });

  it('does nothing with the demo flag on: no request and no store entry', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '1');

    renderHook(() => useInventario(MOCK_CENTROS_AYUDA, new FakeRealtimePort()));

    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    expect(useInventarioStore.getState().itemsByCentro).toEqual({});
  });

  it('does not fake data on a failed read: the center keeps its items', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, { mensaje: 'boom' }));

    renderHook(() => useInventario(CENTROS, new FakeRealtimePort()));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(useInventarioStore.getState().itemsByCentro).toEqual({});
  });

  it('re-reads the map read-model when a /topic/alerts frame arrives, without touching inventory', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, []));
    const port = new FakeRealtimePort();
    const onReadModelChange = vi.fn();

    renderHook(() => useInventario(CENTROS, port, onReadModelChange));

    act(() =>
      port.emit(DESTINATIONS.alertas, {
        centroAcopioId: 'c-1',
        itemId: 'i-1',
        nombre: 'Agua potable',
        cantidadSolicitada: 8,
        disponibleActual: 5,
        faltante: 3,
        creadaEn: '2026-09-28T12:00:00Z',
      }),
    );

    expect(onReadModelChange).toHaveBeenCalledTimes(1);
    // The alert channel is not inventory: no item is merged by it.
    expect(useInventarioStore.getState().itemsByCentro).toEqual({});
  });
});
