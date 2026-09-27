import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '@/services/apiClient';
import { fetchFlota, fromWireAmbulancia } from './fleet-api';

const DRIVER = '8b6f2f0e-0000-4000-8000-0000000000d1';

/** A live-shaped unit as `GET /flota/ambulancias` returns it. */
const WIRE_UNIT = {
  id: '8b6f2f0e-0000-4000-8000-0000000000a2',
  placa: 'ABC202',
  estado: 'DISPONIBLE',
  ubicacion: { lat: 4.745, lng: -74.095 },
  zona: 'Suba',
  conductorId: DRIVER,
};

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('fromWireAmbulancia', () => {
  it('maps the wire unit and translates its estado', () => {
    expect(fromWireAmbulancia(WIRE_UNIT)).toEqual({
      id: WIRE_UNIT.id,
      placa: WIRE_UNIT.placa,
      estado: 'AVAILABLE',
      ubicacion: { lat: 4.745, lng: -74.095 },
      zona: 'Suba',
      driverName: '',
      conductorId: DRIVER,
    });
  });

  it('omits conductorId when the unit has no driver, instead of inventing one', () => {
    const mapped = fromWireAmbulancia({ ...WIRE_UNIT, conductorId: null });
    expect(mapped).not.toBeNull();
    expect(mapped?.conductorId).toBeUndefined();
  });

  it('returns null on a malformed unit instead of a blind cast', () => {
    expect(fromWireAmbulancia(null)).toBeNull();
    expect(fromWireAmbulancia({ ...WIRE_UNIT, estado: 'DESCONOCIDO' })).toBeNull();
    expect(fromWireAmbulancia({ ...WIRE_UNIT, ubicacion: { lat: 'x', lng: 0 } })).toBeNull();
    expect(fromWireAmbulancia({ ...WIRE_UNIT, id: '' })).toBeNull();
  });
});

describe('fetchFlota', () => {
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

  it('GETs /flota/ambulancias and maps every unit', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, [WIRE_UNIT]));

    const flota = await fetchFlota();

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/flota/ambulancias');
    expect(options.method ?? 'GET').toBe('GET');
    expect(flota).toHaveLength(1);
    expect(flota[0]?.conductorId).toBe(DRIVER);
  });

  it('drops a malformed unit without dropping the whole fleet', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, [WIRE_UNIT, { id: 'broken' }]));

    const flota = await fetchFlota();

    expect(flota).toHaveLength(1);
    expect(flota[0]?.id).toBe(WIRE_UNIT.id);
  });
});
