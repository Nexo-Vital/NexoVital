import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '@/services/apiClient';
import { fetchHistorialSolicitudes } from './history-api';

/** Two assigned requests, newest first exactly as the backend orders them. */
const WIRE_HISTORY = [
  {
    id: '8b6f2f0e-0000-4000-8000-0000000000a1',
    ubicacion: { lat: 4.745, lng: -74.095 },
    emergenciaId: null,
    estado: 'TOMADA',
    centroAyudaId: 'CA-CRUE',
    zonaId: 'Suba',
    solicitadaEn: '2026-01-02T10:00:00.000Z',
    timeoutEn: '2026-01-02T10:45:00.000Z',
    ambulanciasNotificadas: ['A-07'],
    ambulanciaAsignadaId: 'A-07',
    llegadaEn: '2026-01-02T10:20:00.000Z',
  },
  {
    id: '8b6f2f0e-0000-4000-8000-0000000000a2',
    ubicacion: { lat: 4.628, lng: -74.148 },
    emergenciaId: null,
    estado: 'ASIGNADA',
    centroAyudaId: null,
    zonaId: null,
    solicitadaEn: '2026-01-01T08:00:00.000Z',
    timeoutEn: '2026-01-01T08:45:00.000Z',
    ambulanciasNotificadas: ['A-07'],
    ambulanciaAsignadaId: 'A-07',
    llegadaEn: null,
  },
];

/** Minimal Response stand-in: apiFetch only reads status, ok, headers.get, json. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('fetchHistorialSolicitudes', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setToken('jwt.test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('reads the driver history endpoint and maps every DTO through the shared mapper', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, WIRE_HISTORY));

    const historial = await fetchHistorialSolicitudes();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/flota/ambulancias/mia/solicitudes',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );
    // Server order is preserved (newest first) and estado is translated.
    expect(historial.map((solicitud) => solicitud.id)).toEqual([
      WIRE_HISTORY[0].id,
      WIRE_HISTORY[1].id,
    ]);
    expect(historial.map((solicitud) => solicitud.estado)).toEqual(['TAKEN', 'ASSIGNED']);
    expect(historial[0].llegadaEn).toBe('2026-01-02T10:20:00.000Z');
    expect(historial[1].llegadaEn).toBeUndefined();
  });

  it('treats a null body (driver without a unit) as an empty history', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, null));

    await expect(fetchHistorialSolicitudes()).resolves.toEqual([]);
  });

  it('drops a malformed row instead of casting it', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, [WIRE_HISTORY[0], { id: '' }]));

    const historial = await fetchHistorialSolicitudes();

    expect(historial.map((solicitud) => solicitud.id)).toEqual([WIRE_HISTORY[0].id]);
  });

  it('surfaces the backend error code and message', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(500, {
        codigo: 'ERROR_CONSULTA_HISTORIAL',
        mensaje: 'No fue posible consultar el historial.',
      }),
    );

    await expect(fetchHistorialSolicitudes()).rejects.toMatchObject({
      status: 500,
      codigo: 'ERROR_CONSULTA_HISTORIAL',
      message: 'No fue posible consultar el historial.',
    });
  });
});
