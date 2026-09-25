import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_CENTROS_AYUDA } from '@/mocks/fixtures';
import { setToken } from '@/services/apiClient';
import {
  fetchInventario,
  fromWireInventario,
  registrarDonacion,
  trafficLightFromWire,
} from './inventory-api';

/** A live-shaped item: the exact backend `ItemInventarioDto`. */
const DTO = {
  id: '11111111-1111-4111-8111-111111111111',
  centroAcopioId: '22222222-2222-4222-8222-222222222222',
  nombre: 'Agua potable',
  disponible: 12,
  requerido: 60,
  semaforo: 'ROJO',
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

describe('trafficLightFromWire', () => {
  it('maps the backend semaforo literals to the front traffic light', () => {
    expect(trafficLightFromWire('ROJO')).toBe('RED');
    expect(trafficLightFromWire('AMARILLO')).toBe('AMBER');
    expect(trafficLightFromWire('VERDE')).toBe('GREEN');
  });
});

describe('fromWireInventario', () => {
  it('maps the wire item and leaves the UI-only fields absent', () => {
    const item = fromWireInventario(DTO);

    expect(item).toEqual({
      id: DTO.id,
      centroAcopioId: DTO.centroAcopioId,
      nombre: DTO.nombre,
      disponible: 12,
      requerido: 60,
      semaforo: 'RED',
    });
    // The API exposes neither the unit nor the grammatical number: the mapper
    // must not invent them.
    expect(item).not.toHaveProperty('grammaticalNumber');
    expect(item).not.toHaveProperty('unidad');
    expect(item).not.toHaveProperty('unitDetail');
  });

  it('rejects a malformed payload instead of returning a half item', () => {
    expect(fromWireInventario(null)).toBeNull();
    expect(fromWireInventario({})).toBeNull();
    expect(fromWireInventario({ ...DTO, semaforo: 'PURPLE' })).toBeNull();
    expect(fromWireInventario({ ...DTO, disponible: '12' })).toBeNull();
    expect(fromWireInventario({ ...DTO, centroAcopioId: undefined })).toBeNull();
  });
});

describe('fetchInventario', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('GETs the center inventory through apiFetch with the Bearer token', async () => {
    setToken('jwt.test');
    fetchMock.mockResolvedValue(mockResponse(200, [DTO]));

    await expect(fetchInventario(DTO.centroAcopioId)).resolves.toEqual([
      expect.objectContaining({ id: DTO.id, semaforo: 'RED' }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/centros-acopio/${DTO.centroAcopioId}/inventario`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );
  });

  it('drops malformed entries and an unexpected body instead of throwing', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, [DTO, { nope: true }]));
    await expect(fetchInventario(DTO.centroAcopioId)).resolves.toHaveLength(1);

    fetchMock.mockResolvedValue(mockResponse(200, { not: 'an array' }));
    await expect(fetchInventario(DTO.centroAcopioId)).resolves.toEqual([]);
  });

  it('returns the demo fixtures with the flag on and never touches the network', async () => {
    vi.stubEnv('VITE_DEMO_MODE', '1');
    const suba = MOCK_CENTROS_AYUDA[0];

    await expect(fetchInventario(suba.id)).resolves.toEqual(suba.items);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bubbles a backend failure as an ApiError instead of inventing data', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, { mensaje: 'boom' }));

    await expect(fetchInventario(DTO.centroAcopioId)).rejects.toMatchObject({ status: 500 });
  });
});

describe('registrarDonacion', () => {
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

  it('POSTs the exact donation body and returns the credited item', async () => {
    const credited = { ...DTO, disponible: 52, semaforo: 'VERDE' };
    fetchMock.mockResolvedValue(mockResponse(200, credited));

    await expect(registrarDonacion(DTO.centroAcopioId, DTO.id, 40)).resolves.toEqual(
      expect.objectContaining({ disponible: 52, semaforo: 'GREEN' }),
    );

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/centros-acopio/${DTO.centroAcopioId}/inventario/donacion`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ itemId: DTO.id, cantidad: 40 });
  });

  it('rejects an unexpected response shape instead of a half item', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ok: true }));

    await expect(registrarDonacion(DTO.centroAcopioId, DTO.id, 40)).rejects.toThrow();
  });

  it('lets the ApiError bubble up with the backend mensaje', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(400, {
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'La donación no es válida: revise el insumo y la cantidad.',
      }),
    );

    await expect(registrarDonacion(DTO.centroAcopioId, DTO.id, 0)).rejects.toMatchObject({
      status: 400,
      codigo: 'DATOS_INVALIDOS',
      message: 'La donación no es válida: revise el insumo y la cantidad.',
    });
  });
});
