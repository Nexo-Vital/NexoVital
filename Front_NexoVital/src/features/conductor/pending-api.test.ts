import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setToken } from '@/services/apiClient';
import { fetchSolicitudesPendientes } from './pending-api';

/** One open request, exactly as the backend `SolicitudAmbulanciaDto` writes it. */
const WIRE_PENDING = {
  id: '8b6f2f0e-0000-4000-8000-0000000000b1',
  ubicacion: { lat: 4.745, lng: -74.095 },
  emergenciaId: null,
  estado: 'PENDIENTE',
  centroAyudaId: null,
  zonaId: null,
  solicitadaEn: '2026-01-02T10:00:00.000Z',
  timeoutEn: '2026-01-02T10:01:00.000Z',
  ambulanciasNotificadas: ['A-07', 'A-12'],
  ambulanciaAsignadaId: null,
  llegadaEn: null,
};

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('fetchSolicitudesPendientes (EP-04.F2.US1, D6)', () => {
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

  it('reads the server-scoped resource with the bearer token', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, [WIRE_PENDING]));

    const pendientes = await fetchSolicitudesPendientes();

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/flota/ambulancias/mia/solicitudes/pendientes');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer jwt.test' });
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]).toMatchObject({
      id: WIRE_PENDING.id,
      estado: 'PENDING',
      timeoutEn: WIRE_PENDING.timeoutEn,
      ambulanciasNotificadas: ['A-07', 'A-12'],
      ubicacion: { lat: 4.745, lng: -74.095 },
    });
  });

  it('degrades JSON null (driver without a unit) to an empty list', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, null));

    await expect(fetchSolicitudesPendientes()).resolves.toEqual([]);
  });

  it('drops a malformed row instead of casting it', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, [{ id: 'sin-ubicacion' }, WIRE_PENDING]));

    const pendientes = await fetchSolicitudesPendientes();

    expect(pendientes.map((item) => item.id)).toEqual([WIRE_PENDING.id]);
  });

  it('lets the backend error bubble up unchanged', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(500, { codigo: 'ERROR_CONSULTA_PENDIENTES', mensaje: 'No fue posible.' }),
    );

    await expect(fetchSolicitudesPendientes()).rejects.toBeInstanceOf(ApiError);
  });
});
