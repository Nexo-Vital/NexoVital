import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '@/services/apiClient';
import { reportarEmergencia } from './emergency-api';

/** A live-shaped 201 body: Spanish enums, server-assigned id/estado/zonaId. */
const WIRE_RESPONSE = {
  id: 'b3f1c0de-0000-4000-8000-000000000001',
  ubicacion: { lat: 4.73, lng: -74.08 },
  tipo: 'DERRUMBE',
  nivel: 'ALTO',
  estado: 'REGISTRADA',
  descripcion: 'Derrumbe en Suba',
  zonaId: 'Suba',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const INPUT = {
  ubicacion: { lat: 4.73, lng: -74.08 },
  tipo: 'LANDSLIDE' as const,
  nivel: 'HIGH' as const,
  descripcion: 'Derrumbe en Suba',
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

describe('reportarEmergencia', () => {
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

  it('POSTs /emergencias with the exact body and never an id, estado or zonaId', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, WIRE_RESPONSE));

    await reportarEmergencia(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/emergencias');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body as string);
    expect(body).toEqual({
      ubicacion: { lat: 4.73, lng: -74.08 },
      tipo: 'DERRUMBE',
      nivel: 'ALTO',
      descripcion: 'Derrumbe en Suba',
    });
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('estado');
    expect(body).not.toHaveProperty('zonaId');
  });

  it('normalizes the Spanish response into the English domain emergency', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, WIRE_RESPONSE));

    await expect(reportarEmergencia(INPUT)).resolves.toEqual({
      id: WIRE_RESPONSE.id,
      ubicacion: { lat: 4.73, lng: -74.08 },
      tipo: 'LANDSLIDE',
      nivel: 'HIGH',
      estado: 'REPORTED',
      descripcion: 'Derrumbe en Suba',
      zonaId: 'Suba',
      createdAt: WIRE_RESPONSE.createdAt,
    });
  });

  it('rejects an unexpected response shape instead of returning a half emergency', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, { ok: true }));

    await expect(reportarEmergencia(INPUT)).rejects.toThrow();
  });

  it('lets the ApiError bubble up with the backend mensaje', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(500, {
        codigo: 'ERROR_REGISTRO_EMERGENCIA',
        mensaje: 'No se pudo registrar la emergencia.',
      }),
    );

    await expect(reportarEmergencia(INPUT)).rejects.toMatchObject({
      status: 500,
      codigo: 'ERROR_REGISTRO_EMERGENCIA',
      message: 'No se pudo registrar la emergencia.',
    });
  });
});
