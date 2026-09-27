import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '@/services/apiClient';
import { aceptarSolicitud, fromWireAceptacion, rechazarSolicitud } from './solicitud-api';

/** A live-shaped accept body: `{ganador, solicitud}` with a server-assigned id. */
const ACCEPT_RESPONSE = {
  ganador: true,
  solicitud: {
    id: '8b6f2f0e-0000-4000-8000-000000000042',
    emergenciaId: '8b6f2f0e-0000-4000-8000-0000000000e1',
    estado: 'ASIGNADA',
    centroAyudaId: '8b6f2f0e-0000-4000-8000-0000000000c1',
    zonaId: 'Suba',
    solicitadaEn: '2026-01-01T00:00:00.000Z',
    timeoutEn: '2026-01-01T00:45:00.000Z',
    ambulanciasNotificadas: ['8b6f2f0e-0000-4000-8000-0000000000a1'],
    ambulanciaAsignadaId: '8b6f2f0e-0000-4000-8000-0000000000a1',
  },
};

/** A live-shaped reject body: the still-PENDIENTE request, unwrapped. */
const REJECT_RESPONSE = {
  ...ACCEPT_RESPONSE.solicitud,
  estado: 'PENDIENTE',
  ambulanciaAsignadaId: null,
};

const AMBULANCIA = '8b6f2f0e-0000-4000-8000-0000000000a1';
const REQUEST_ID = '8b6f2f0e-0000-4000-8000-000000000042';

/** Minimal Response stand-in: apiFetch only reads status, ok, headers.get, json. */
function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('fromWireAceptacion', () => {
  it('maps the accept response and translates the nested estado', () => {
    const outcome = fromWireAceptacion(ACCEPT_RESPONSE);
    expect(outcome?.winner).toBe(true);
    expect(outcome?.solicitud.estado).toBe('ASSIGNED');
    expect(outcome?.solicitud.ambulanciaAsignadaId).toBe(AMBULANCIA);
  });

  it('keeps a lost CAS flag as winner=false instead of assuming a win', () => {
    const outcome = fromWireAceptacion({ ...ACCEPT_RESPONSE, ganador: false });
    expect(outcome?.winner).toBe(false);
  });

  it('returns null on a malformed body instead of a blind cast', () => {
    expect(fromWireAceptacion(null)).toBeNull();
    expect(fromWireAceptacion('nope')).toBeNull();
    expect(fromWireAceptacion({})).toBeNull();
    expect(fromWireAceptacion({ ganador: 'yes', solicitud: ACCEPT_RESPONSE.solicitud })).toBeNull();
    expect(fromWireAceptacion({ ganador: true })).toBeNull();
    expect(fromWireAceptacion({ ganador: true, solicitud: { id: '' } })).toBeNull();
  });
});

describe('aceptarSolicitud', () => {
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

  it('POSTs /solicitudes/{id}/accept with the contract body and returns the server request', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, ACCEPT_RESPONSE));

    const outcome = await aceptarSolicitud(REQUEST_ID, AMBULANCIA);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${REQUEST_ID}/accept`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ ambulanciaId: AMBULANCIA });
    expect(outcome.winner).toBe(true);
    expect(outcome.solicitud).toMatchObject({ id: REQUEST_ID, estado: 'ASSIGNED' });
  });

  it('rejects an unexpected response shape instead of returning a half outcome', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ok: true }));

    await expect(aceptarSolicitud(REQUEST_ID, AMBULANCIA)).rejects.toThrow();
  });

  it('lets the 409 ApiError bubble up with the backend mensaje', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'CAS_PERDIDO',
        mensaje: 'Solicitud ya asignada a otra ambulancia.',
      }),
    );

    await expect(aceptarSolicitud(REQUEST_ID, AMBULANCIA)).rejects.toMatchObject({
      status: 409,
      codigo: 'CAS_PERDIDO',
      message: 'Solicitud ya asignada a otra ambulancia.',
    });
  });
});

describe('rechazarSolicitud', () => {
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

  it('POSTs /solicitudes/{id}/reject with the contract body and returns the still-open request', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, REJECT_RESPONSE));

    const solicitud = await rechazarSolicitud(REQUEST_ID, AMBULANCIA);

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${REQUEST_ID}/reject`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ ambulanciaId: AMBULANCIA });
    expect(solicitud.estado).toBe('PENDING');
    expect(solicitud.ambulanciaAsignadaId).toBeNull();
  });

  it('rejects an unexpected response shape instead of a blind cast', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { estado: 'PENDIENTE' }));

    await expect(rechazarSolicitud(REQUEST_ID, AMBULANCIA)).rejects.toThrow();
  });
});
