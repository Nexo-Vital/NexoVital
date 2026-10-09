import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '@/services/apiClient';
import { fetchFlota, fetchMiAmbulancia, fromWireAmbulancia, reportarPosicion } from './fleet-api';

/** A live-shaped unit as `GET /flota/ambulancias` returns it. */
const WIRE_UNIT = {
  id: '8b6f2f0e-0000-4000-8000-0000000000a2',
  placa: 'ABC202',
  estado: 'DISPONIBLE',
  ubicacion: { lat: 4.745, lng: -74.095 },
  zona: 'Suba',
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
    });
  });

  it('never invents a conductorId: the general projection does not carry one', () => {
    // Even if a server sends one, the general read-model must not disclose it.
    const mapped = fromWireAmbulancia({ ...WIRE_UNIT, conductorId: 'driver-1' });
    expect(mapped).not.toBeNull();
    expect(mapped?.conductorId).toBeUndefined();
  });

  it('names the driver with the conductorNombre the server sends', () => {
    expect(fromWireAmbulancia({ ...WIRE_UNIT, conductorNombre: 'Carlos Pérez' })?.driverName).toBe(
      'Carlos Pérez',
    );
    expect(fromWireAmbulancia({ ...WIRE_UNIT, conductorNombre: null })?.driverName).toBe('');
  });

  it('returns null on a malformed unit instead of a blind cast', () => {
    expect(fromWireAmbulancia(null)).toBeNull();
    expect(fromWireAmbulancia({ ...WIRE_UNIT, estado: 'DESCONOCIDO' })).toBeNull();
    expect(fromWireAmbulancia({ ...WIRE_UNIT, ubicacion: { lat: 'x', lng: 0 } })).toBeNull();
    expect(fromWireAmbulancia({ ...WIRE_UNIT, id: '' })).toBeNull();
  });

  it('carries the signal fields and the version the server sends (EP-04.F1.US1)', () => {
    const mapped = fromWireAmbulancia({
      ...WIRE_UNIT,
      sinSenal: true,
      ultimaPosicionEn: '2026-10-06T15:00:00Z',
      version: 7,
    });

    expect(mapped?.sinSenal).toBe(true);
    expect(mapped?.ultimaPosicionEn).toBe('2026-10-06T15:00:00Z');
    expect(mapped?.version).toBe(7);
  });

  it('keeps a unit that never reported: no signal lost, no report instant', () => {
    const mapped = fromWireAmbulancia({
      ...WIRE_UNIT,
      sinSenal: false,
      ultimaPosicionEn: null,
      version: 0,
    });

    expect(mapped?.sinSenal).toBe(false);
    expect(mapped?.ultimaPosicionEn).toBeNull();
    expect(mapped?.version).toBe(0);
  });

  it('ignores signal fields of the wrong type instead of dropping the unit', () => {
    const mapped = fromWireAmbulancia({ ...WIRE_UNIT, sinSenal: 'si', version: '7' });

    expect(mapped).not.toBeNull();
    expect(mapped?.sinSenal).toBeUndefined();
    expect(mapped?.version).toBeUndefined();
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
    expect(flota[0]?.conductorId).toBeUndefined();
  });

  it('drops a malformed unit without dropping the whole fleet', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, [WIRE_UNIT, { id: 'broken' }]));

    const flota = await fetchFlota();

    expect(flota).toHaveLength(1);
    expect(flota[0]?.id).toBe(WIRE_UNIT.id);
  });
});

describe('fetchMiAmbulancia', () => {
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

  it('GETs the server-scoped /mia resource and maps the caller unit', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, WIRE_UNIT));

    const mia = await fetchMiAmbulancia();

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/v1/flota/ambulancias/mia');
    expect(options.method ?? 'GET').toBe('GET');
    expect(mia?.id).toBe(WIRE_UNIT.id);
  });

  it('returns null for JSON null (driver without a unit) instead of inventing one', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, null));

    await expect(fetchMiAmbulancia()).resolves.toBeNull();
  });
});

describe('reportarPosicion', () => {
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

  it('POSTs the position of the unit to its /posicion resource', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, WIRE_UNIT));

    await reportarPosicion(WIRE_UNIT.id, { lat: 4.75, lng: -74.09 }, 90);

    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/v1/flota/ambulancias/${WIRE_UNIT.id}/posicion`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({
      ubicacion: { lat: 4.75, lng: -74.09 },
      heading: 90,
    });
  });

  it('sends the heading as whole degrees and null when the device has none', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, WIRE_UNIT));

    await reportarPosicion(WIRE_UNIT.id, { lat: 4.75, lng: -74.09 }, 89.6);
    await reportarPosicion(WIRE_UNIT.id, { lat: 4.75, lng: -74.09 }, null);

    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse(String((call as [string, RequestInit])[1].body)) as { heading: unknown },
    );
    expect(bodies.map((body) => body.heading)).toEqual([90, null]);
  });

  it('never claims a source: the route always speaks for a device', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, WIRE_UNIT));

    await reportarPosicion(WIRE_UNIT.id, { lat: 4.75, lng: -74.09 }, null);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(Object.keys(JSON.parse(String(options.body)) as object).sort()).toEqual([
      'heading',
      'ubicacion',
    ]);
  });

  it('rejects when the server refuses the report (the unit belongs to another driver)', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(409, { codigo: 'AMBULANCIA_AJENA', mensaje: 'La unidad no es tuya.' }),
    );

    await expect(
      reportarPosicion(WIRE_UNIT.id, { lat: 4.75, lng: -74.09 }, null),
    ).rejects.toMatchObject({ status: 409, codigo: 'AMBULANCIA_AJENA' });
  });
});
