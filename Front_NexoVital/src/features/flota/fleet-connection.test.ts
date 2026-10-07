import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '@/services/apiClient';
import { DESTINATIONS } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import type { Ambulancia } from '@/types/domain';
import {
  conectarMiAmbulancia,
  declararDisponibilidadMiAmbulancia,
  desconectarMiAmbulancia,
  fromWireAmbulancia,
} from './fleet-api';
import { useFleetStore } from './fleet-store';
import { useFleetSync } from './use-fleet-sync';

/**
 * EP-04.F2.US1, D2: `conectada` is data of the unit. It arrives on the REST
 * read, on the response of the two connection commands and on its own
 * `/topic/flota` frame, and it is ordered by the row version like everything
 * else.
 */

const UNIT_ID = '8b6f2f0e-0000-4000-8000-0000000000a1';

const WIRE_UNIT = {
  id: UNIT_ID,
  placa: 'ABC101',
  estado: 'DISPONIBLE',
  ubicacion: { lat: 4.735, lng: -74.08 },
  zona: 'Suba',
  sinSenal: false,
  ultimaPosicionEn: null,
  version: 3,
  conectada: true,
};

function unit(overrides: Partial<Ambulancia> = {}): Ambulancia {
  return {
    id: UNIT_ID,
    placa: 'ABC101',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.735, lng: -74.08 },
    zona: 'Suba',
    driverName: '',
    ...overrides,
  };
}

function held(): Ambulancia | undefined {
  return useFleetStore.getState().units.find((item) => item.id === UNIT_ID);
}

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

describe('fromWireAmbulancia: connection', () => {
  it('carries `conectada` when the server sends it', () => {
    expect(fromWireAmbulancia(WIRE_UNIT)?.conectada).toBe(true);
    expect(fromWireAmbulancia({ ...WIRE_UNIT, conectada: false })?.conectada).toBe(false);
  });

  it('leaves it absent for a backend that predates the field', () => {
    const { conectada: _omitted, ...legacy } = WIRE_UNIT;

    expect(fromWireAmbulancia(legacy)).not.toHaveProperty('conectada');
  });
});

describe('connection commands', () => {
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

  it('conectarMiAmbulancia posts to the server-scoped route and returns the unit', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ...WIRE_UNIT, version: 4 }));

    const unidad = await conectarMiAmbulancia();

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/flota/ambulancias/mia/conectar');
    expect(options.method).toBe('POST');
    // No unit id travels: the server resolves the unit from the caller.
    expect(options.body).toBeUndefined();
    expect(unidad).toMatchObject({ id: UNIT_ID, conectada: true, version: 4 });
  });

  it('desconectarMiAmbulancia posts to its own route', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ...WIRE_UNIT, conectada: false, version: 5 }));

    const unidad = await desconectarMiAmbulancia();

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/flota/ambulancias/mia/desconectar');
    expect(options.method).toBe('POST');
    expect(unidad).toMatchObject({ conectada: false, version: 5 });
  });

  it('a 409 SOLICITUD_EN_CURSO bubbles up with the reason of the server', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(409, {
        codigo: 'SOLICITUD_EN_CURSO',
        mensaje: 'Finaliza el servicio en curso para poder desconectarte.',
      }),
    );

    await expect(desconectarMiAmbulancia()).rejects.toMatchObject({
      status: 409,
      codigo: 'SOLICITUD_EN_CURSO',
      message: 'Finaliza el servicio en curso para poder desconectarte.',
    });
  });

  it('declararDisponibilidadMiAmbulancia posts the declared availability', async () => {
    fetchMock.mockResolvedValue(
      mockResponse(200, { ...WIRE_UNIT, estado: 'MANTENIMIENTO', version: 6 }),
    );

    const unidad = await declararDisponibilidadMiAmbulancia(false);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/flota/ambulancias/mia/disponibilidad');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({ disponible: false });
    expect(unidad).toMatchObject({ estado: 'MAINTENANCE', version: 6 });
  });

  it('JSON null (driver without a unit) is a valid "no unit" answer', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, null));

    await expect(conectarMiAmbulancia()).resolves.toBeNull();
  });
});

describe('fleet-store: connection', () => {
  beforeEach(() => useFleetStore.setState({ units: [] }));

  it('adopt applies the unit a command answered with', () => {
    useFleetStore.setState({ units: [unit({ conectada: true, version: 3 })] });

    useFleetStore.getState().adopt(unit({ conectada: false, version: 4 }));

    expect(held()).toMatchObject({ conectada: false, version: 4 });
  });

  it('adopt drops an answer older than the frame that already landed', () => {
    // The frame of a LATER change (version 5) arrived before the response of
    // the earlier command (version 4).
    useFleetStore.setState({ units: [unit({ conectada: true, version: 5 })] });

    useFleetStore.getState().adopt(unit({ conectada: false, version: 4 }));

    expect(held()).toMatchObject({ conectada: true, version: 5 });
  });

  it('hydrate keeps the newer local connection over an older snapshot', () => {
    useFleetStore.setState({ units: [unit({ conectada: false, version: 6 })] });

    useFleetStore.getState().hydrate([unit({ conectada: true, version: 5 })]);

    expect(held()).toMatchObject({ conectada: false, version: 6 });
  });

  it('hydrate takes the connection of a newer snapshot', () => {
    useFleetStore.setState({ units: [unit({ conectada: true, version: 5 })] });

    useFleetStore.getState().hydrate([unit({ conectada: false, version: 6 })]);

    expect(held()).toMatchObject({ conectada: false, version: 6 });
  });
});

describe('useFleetSync: connection frame', () => {
  beforeEach(() => useFleetStore.setState({ units: [] }));
  afterEach(cleanup);

  function mount() {
    const port = new FakeRealtimePort();
    renderHook(() => useFleetSync(port));
    return port;
  }

  it('applies the connection frame to a known unit and keeps the rest', () => {
    const port = mount();
    act(() =>
      useFleetStore.setState({ units: [unit({ conectada: true, sinSenal: false, version: 3 })] }),
    );

    act(() =>
      port.emit(DESTINATIONS.flota, {
        ambulanciaId: UNIT_ID,
        estado: 'DISPONIBLE',
        conectada: false,
        version: 4,
      }),
    );

    expect(held()).toMatchObject({
      conectada: false,
      estado: 'AVAILABLE',
      version: 4,
      ubicacion: { lat: 4.735, lng: -74.08 },
      sinSenal: false,
    });
  });

  it('discards a connection frame older than what the store holds', () => {
    const port = mount();
    act(() => useFleetStore.setState({ units: [unit({ conectada: true, version: 7 })] }));

    act(() =>
      port.emit(DESTINATIONS.flota, {
        ambulanciaId: UNIT_ID,
        estado: 'DISPONIBLE',
        conectada: false,
        version: 6,
      }),
    );

    expect(held()).toMatchObject({ conectada: true, version: 7 });
  });

  it('a state frame says nothing about the connection: it is kept', () => {
    const port = mount();
    act(() => useFleetStore.setState({ units: [unit({ conectada: false, version: 3 })] }));

    act(() =>
      port.emit(DESTINATIONS.flota, { ambulanciaId: UNIT_ID, estado: 'EN_MISION', version: 4 }),
    );

    expect(held()).toMatchObject({ conectada: false, estado: 'ASSIGNED', version: 4 });
  });

  it('a position frame says nothing about the connection either', () => {
    const port = mount();
    act(() => useFleetStore.setState({ units: [unit({ conectada: false, version: 3 })] }));

    act(() =>
      port.emit(DESTINATIONS.flota, {
        ambulanceId: UNIT_ID,
        ubicacion: { lat: 4.74, lng: -74.09 },
        estado: 'AVAILABLE',
        heading: null,
        source: 'simulated',
        sinSenal: false,
        ultimaPosicionEn: '2026-01-02T10:00:00.000Z',
        version: 4,
      }),
    );

    expect(held()).toMatchObject({
      conectada: false,
      ubicacion: { lat: 4.74, lng: -74.09 },
      version: 4,
    });
  });
});
