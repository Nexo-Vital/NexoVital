import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '@/services/apiClient';
import { fromWireSolicitudAmbulancia, fetchSolicitudDetalle, solicitarAmbulancia } from './solicitud-api';

/** A live-shaped 201 body: server-assigned id/estado/timestamps. */
const WIRE_RESPONSE = {
  id: '8b6f2f0e-0000-4000-8000-000000000042',
  ubicacion: { lat: 4.728, lng: -74.078 },
  emergenciaId: 'REQ-FRONT-1',
  estado: 'PENDIENTE',
  centroAyudaId: 'CA-CRUE',
  zonaId: 'Suba',
  solicitadaEn: '2026-01-01T00:00:00.000Z',
  timeoutEn: '2026-01-01T00:45:00.000Z',
  ambulanciasNotificadas: ['A-07', 'A-12', 'A-03'],
  ambulanciaAsignadaId: null,
};

const BODY = {
  ubicacion: { lat: 4.728, lng: -74.078 },
  emergenciaId: 'REQ-FRONT-1',
  centroAyudaId: 'CA-CRUE',
  zonaId: 'Suba',
  timeoutEn: '2026-01-01T00:45:00.000Z',
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

describe('fromWireSolicitudAmbulancia', () => {
  it('maps the backend DTO and translates its estado to the English domain value', () => {
    expect(fromWireSolicitudAmbulancia(WIRE_RESPONSE)).toEqual({
      id: WIRE_RESPONSE.id,
      ubicacion: WIRE_RESPONSE.ubicacion,
      emergenciaId: WIRE_RESPONSE.emergenciaId,
      estado: 'PENDING',
      centroAyudaId: WIRE_RESPONSE.centroAyudaId,
      zonaId: WIRE_RESPONSE.zonaId,
      tipo: '',
      solicitadaEn: WIRE_RESPONSE.solicitadaEn,
      timeoutEn: WIRE_RESPONSE.timeoutEn,
      ambulanciasNotificadas: ['A-07', 'A-12', 'A-03'],
      notifiedCount: 3,
      ambulanciaAsignadaId: null,
      // EP-04.F2.US4: the counter is always present on the mapped request; an
      // older payload that omits it degrades to 0.
      reintentos: 0,
    });
  });

  it('parses the retry counter and defaults it to 0 when the payload omits it', () => {
    // Present: copied as a finite, non-negative number.
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, reintentos: 2 })?.reintentos).toBe(2);
    // Absent (older backend) and malformed values degrade to 0, never reject.
    expect(fromWireSolicitudAmbulancia(WIRE_RESPONSE)?.reintentos).toBe(0);
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, reintentos: -1 })?.reintentos).toBe(0);
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, reintentos: 'x' })?.reintentos).toBe(0);
    expect(
      fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, reintentos: Number.NaN })?.reintentos,
    ).toBe(0);
  });

  it('accepts a standalone request whose emergency, center and zone are null', () => {
    const mapped = fromWireSolicitudAmbulancia({
      ...WIRE_RESPONSE,
      emergenciaId: null,
      centroAyudaId: null,
      zonaId: null,
    });

    // Nullable context is normalized to empty strings, never invented ids.
    expect(mapped).toMatchObject({ emergenciaId: '', centroAyudaId: '', zonaId: '' });
    expect(mapped?.ubicacion).toEqual(WIRE_RESPONSE.ubicacion);
  });

  it('translates every lifecycle literal the backend can emit', () => {
    const cases = {
      PENDIENTE: 'PENDING',
      ASIGNADA: 'ASSIGNED',
      CONFIRMADA: 'CONFIRMED',
      TOMADA: 'TAKEN',
      RECHAZADA: 'REJECTED',
      TIMEOUT: 'TIMEOUT',
    } as const;

    for (const [wire, expected] of Object.entries(cases)) {
      expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, estado: wire })?.estado).toBe(
        expected,
      );
    }
  });

  it('keeps a winning unit when the request is already assigned', () => {
    const mapped = fromWireSolicitudAmbulancia({
      ...WIRE_RESPONSE,
      estado: 'ASIGNADA',
      ambulanciaAsignadaId: 'A-07',
    });

    expect(mapped?.ambulanciaAsignadaId).toBe('A-07');
  });

  it('returns null on a malformed payload instead of a blind cast', () => {
    expect(fromWireSolicitudAmbulancia(null)).toBeNull();
    expect(fromWireSolicitudAmbulancia('nope')).toBeNull();
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, id: '' })).toBeNull();
    // The pickup point is required: a request with no valid location is dropped.
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, ubicacion: undefined })).toBeNull();
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, ubicacion: 'nope' })).toBeNull();
    expect(
      fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, ubicacion: { lat: 'x', lng: 1 } }),
    ).toBeNull();
    // A non-empty string OR null is valid context; a wrong type is not.
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, emergenciaId: 7 })).toBeNull();
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, zonaId: 7 })).toBeNull();
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, estado: 'DESCONOCIDO' })).toBeNull();
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, estado: 'toString' })).toBeNull();
    expect(
      fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, solicitadaEn: 'not-a-date' }),
    ).toBeNull();
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, timeoutEn: 42 })).toBeNull();
    expect(
      fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, ambulanciasNotificadas: 'A-07' }),
    ).toBeNull();
    expect(
      fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, ambulanciasNotificadas: [1, 2] }),
    ).toBeNull();
    expect(fromWireSolicitudAmbulancia({ ...WIRE_RESPONSE, ambulanciaAsignadaId: 7 })).toBeNull();
  });
});

describe('solicitarAmbulancia', () => {
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

  it('POSTs /solicitudes with the exact contract body and returns the server request', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, WIRE_RESPONSE));

    const solicitud = await solicitarAmbulancia(BODY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/solicitudes');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual(BODY);
    expect(solicitud).toMatchObject({
      id: WIRE_RESPONSE.id,
      estado: 'PENDING',
      ambulanciasNotificadas: ['A-07', 'A-12', 'A-03'],
    });
  });

  it('rejects an unexpected response shape instead of returning a half request', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, { ok: true }));

    await expect(solicitarAmbulancia(BODY)).rejects.toThrow();
  });

  it('lets the ApiError bubble up with the backend mensaje', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'AMBULANCIA_NO_DISPONIBLE',
        mensaje: 'No hay ambulancias disponibles para atender la solicitud.',
      }),
    );

    await expect(solicitarAmbulancia(BODY)).rejects.toMatchObject({
      status: 409,
      codigo: 'AMBULANCIA_NO_DISPONIBLE',
      message: 'No hay ambulancias disponibles para atender la solicitud.',
    });
  });
});

describe('fetchSolicitudDetalle', () => {
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

  it('GETs /solicitudes/{id} and maps the server request', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, WIRE_RESPONSE));

    const solicitud = await fetchSolicitudDetalle(WIRE_RESPONSE.id);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/solicitudes/${WIRE_RESPONSE.id}`);
    // No explicit method: fetch defaults to GET for this read.
    expect(options.method ?? 'GET').toBe('GET');
    expect(solicitud).toMatchObject({
      id: WIRE_RESPONSE.id,
      estado: 'PENDING',
      solicitadaEn: WIRE_RESPONSE.solicitadaEn,
      ambulanciasNotificadas: ['A-07', 'A-12', 'A-03'],
    });
  });

  it('rejects an unexpected response shape instead of returning a half request', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ok: true }));

    await expect(fetchSolicitudDetalle(WIRE_RESPONSE.id)).rejects.toThrow();
  });
});
