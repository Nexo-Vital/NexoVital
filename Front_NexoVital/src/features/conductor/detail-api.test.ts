import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setToken } from '@/services/apiClient';
import { fetchSolicitudDetalle } from './detail-api';

const REQUEST = '8b6f2f0e-0000-4000-8000-0000000000c1';

/** One request, exactly as the backend `SolicitudAmbulanciaDto` writes it. */
const WIRE_DETAIL = {
  id: REQUEST,
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

describe('fetchSolicitudDetalle (EP-04.F2.US3)', () => {
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

  it('reads the request by id with the bearer token and maps it', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, WIRE_DETAIL));

    const detalle = await fetchSolicitudDetalle(REQUEST);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/solicitudes/${REQUEST}`);
    expect(options.method ?? 'GET').toBe('GET');
    expect(options.headers).toMatchObject({ Authorization: 'Bearer jwt.test' });
    expect(detalle).toMatchObject({
      id: REQUEST,
      estado: 'PENDING',
      ubicacion: { lat: 4.745, lng: -74.095 },
      solicitadaEn: WIRE_DETAIL.solicitadaEn,
      timeoutEn: WIRE_DETAIL.timeoutEn,
      ambulanciasNotificadas: ['A-07', 'A-12'],
      ambulanciaAsignadaId: null,
    });
  });

  it('carries the state and the winning unit of a request that was taken', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, { ...WIRE_DETAIL, estado: 'ASIGNADA', ambulanciaAsignadaId: 'A-12' }),
    );

    await expect(fetchSolicitudDetalle(REQUEST)).resolves.toMatchObject({
      estado: 'ASSIGNED',
      ambulanciaAsignadaId: 'A-12',
    });
  });

  it('answers null for a malformed body instead of casting it', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { id: REQUEST }));

    await expect(fetchSolicitudDetalle(REQUEST)).resolves.toBeNull();
  });

  it('lets 403 SOLICITUD_NO_NOTIFICADA bubble up unchanged', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(403, {
        codigo: 'SOLICITUD_NO_NOTIFICADA',
        mensaje: 'Esta solicitud no fue notificada a tu ambulancia.',
      }),
    );

    const error = await fetchSolicitudDetalle(REQUEST).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).codigo).toBe('SOLICITUD_NO_NOTIFICADA');
  });

  it('lets 404 SOLICITUD_NO_ENCONTRADA bubble up unchanged', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(404, { codigo: 'SOLICITUD_NO_ENCONTRADA', mensaje: 'No existe.' }),
    );

    const error = await fetchSolicitudDetalle(REQUEST).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });
});
