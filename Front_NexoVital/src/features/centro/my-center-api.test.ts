import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, setToken } from '@/services/apiClient';
import {
  agregarInsumo,
  crearMiCentro,
  fetchMiCentro,
  fromWireMiCentro,
  retirarInsumo,
} from './my-center-api';

const CENTRO_ID = '22222222-2222-4222-8222-222222222222';

/** A live-shaped item: the exact backend `ItemInventarioDto`. */
const AGUA = {
  id: '11111111-1111-4111-8111-111111111111',
  centroAcopioId: CENTRO_ID,
  nombre: 'Agua potable',
  disponible: 20,
  requerido: 60,
  semaforo: 'ROJO',
};

/** A live-shaped center: the exact backend `MiCentroDto`. */
const CENTRO = {
  id: CENTRO_ID,
  nombre: 'Centro Rincón',
  ubicacion: { lat: 4.75, lng: -74.06 },
  items: [AGUA],
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

describe('fromWireMiCentro', () => {
  it('maps the center and its items onto the front domain', () => {
    expect(fromWireMiCentro(CENTRO)).toEqual({
      id: CENTRO_ID,
      nombre: 'Centro Rincón',
      ubicacion: { lat: 4.75, lng: -74.06 },
      items: [
        {
          id: AGUA.id,
          centroAcopioId: CENTRO_ID,
          nombre: 'Agua potable',
          disponible: 20,
          requerido: 60,
          semaforo: 'RED',
        },
      ],
    });
  });

  it('drops a malformed item without dropping the center', () => {
    const centro = fromWireMiCentro({ ...CENTRO, items: [AGUA, { id: 7 }] });

    expect(centro?.items).toHaveLength(1);
  });

  it('returns null for a malformed center', () => {
    expect(fromWireMiCentro(null)).toBeNull();
    expect(fromWireMiCentro({ ...CENTRO, ubicacion: { lat: '4.75', lng: -74.06 } })).toBeNull();
    expect(fromWireMiCentro({ ...CENTRO, id: undefined })).toBeNull();
  });
});

describe('my center API', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setToken('jwt.test');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the caller center with the bearer token', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, CENTRO));

    const centro = await fetchMiCentro();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/centros-acopio/mio',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt.test' }),
      }),
    );
    expect(centro?.nombre).toBe('Centro Rincón');
  });

  it('reads "no center yet" (404) as null, not as an error', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(404, {
        codigo: 'CENTRO_NO_REGISTRADO',
        mensaje: 'Todavía no has creado tu centro.',
      }),
    );

    await expect(fetchMiCentro()).resolves.toBeNull();
  });

  it('lets any other failure bubble, so it is never mistaken for "no center"', async () => {
    fetchMock.mockResolvedValue(mockResponse(500, { codigo: 'ERROR', mensaje: 'Falló' }));

    await expect(fetchMiCentro()).rejects.toBeInstanceOf(ApiError);
  });

  it('creates the center with its supplies and returns it', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, CENTRO));
    const input = {
      nombre: 'Centro Rincón',
      ubicacion: { lat: 4.75, lng: -74.06 },
      items: [{ nombre: 'Agua potable', disponible: 20, requerido: 60 }],
    };

    const centro = await crearMiCentro(input);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/centros-acopio/mio');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(input);
    expect(centro.items).toHaveLength(1);
  });

  it('surfaces the backend message when the name is taken', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'NOMBRE_CENTRO_DUPLICADO',
        mensaje: 'Ya existe un centro con ese nombre. Elige otro.',
      }),
    );

    await expect(
      crearMiCentro({ nombre: 'X', ubicacion: { lat: 4.75, lng: -74.06 }, items: [] }),
    ).rejects.toThrow('Ya existe un centro con ese nombre. Elige otro.');
  });

  it('declares a new supply on the caller center', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, { ...AGUA, nombre: 'Cobijas' }));

    const item = await agregarInsumo({ nombre: 'Cobijas', disponible: 5, requerido: 40 });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/centros-acopio/mio/inventario');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ nombre: 'Cobijas', disponible: 5, requerido: 40 });
    expect(item.nombre).toBe('Cobijas');
  });

  it('withdraws units through the existing dispatch endpoint', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ...AGUA, disponible: 8 }));

    const item = await retirarInsumo(CENTRO_ID, AGUA.id, 12);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/v1/centros-acopio/${CENTRO_ID}/inventario/despacho`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ itemId: AGUA.id, cantidad: 12 });
    expect(item.disponible).toBe(8);
  });

  it('sends the reason of the withdrawal when there is one', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ...AGUA, disponible: 8 }));

    await retirarInsumo(CENTRO_ID, AGUA.id, 12, 'Entrega al albergue');

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      itemId: AGUA.id,
      cantidad: 12,
      motivo: 'Entrega al albergue',
    });
  });

  it('surfaces the 409 when the stock no longer covers the withdrawal', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'STOCK_INSUFICIENTE',
        mensaje: 'No hay unidades suficientes del insumo para atender la solicitud.',
      }),
    );

    await expect(retirarInsumo(CENTRO_ID, AGUA.id, 99)).rejects.toThrow(
      'No hay unidades suficientes del insumo para atender la solicitud.',
    );
  });
});
