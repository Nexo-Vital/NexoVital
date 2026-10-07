import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/components/ui/toast';
import { ApiError } from '@/services/apiClient';
import type { Ambulancia } from '@/types/domain';
import { useDriverOnlineStore } from './driver-online-store';
import { useDriverConnection } from './use-driver-connection';

/**
 * EP-04.F2.US1, D3: against the backend the driver's connection is DATA of the
 * unit and the two buttons are REST commands. In demo mode, and for a unit that
 * does not carry `conectada`, it stays the local toggle.
 */

const { mockConectar, mockDesconectar, mockDisponibilidad } = vi.hoisted(() => ({
  mockConectar: vi.fn(),
  mockDesconectar: vi.fn(),
  mockDisponibilidad: vi.fn(),
}));

vi.mock('@/features/flota/fleet-api', () => ({
  conectarMiAmbulancia: mockConectar,
  desconectarMiAmbulancia: mockDesconectar,
  declararDisponibilidadMiAmbulancia: mockDisponibilidad,
}));

function unit(overrides: Partial<Ambulancia> = {}): Ambulancia {
  return {
    id: 'unit-1',
    placa: 'ABC101',
    estado: 'AVAILABLE',
    ubicacion: { lat: 4.74, lng: -74.09 },
    zona: 'Suba',
    driverName: '',
    ...overrides,
  };
}

describe('useDriverConnection', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', '0');
    mockConectar.mockReset();
    mockDesconectar.mockReset();
    mockDisponibilidad.mockReset();
  });

  afterEach(() => {
    cleanup();
    useDriverOnlineStore.setState({ online: false });
    useToastStore.setState({ toasts: [] });
    vi.unstubAllEnvs();
  });

  it('reads the connection from the unit the server reported', () => {
    const connected = renderHook(() => useDriverConnection(unit({ conectada: true })));
    expect(connected.result.current.serverManaged).toBe(true);
    expect(connected.result.current.online).toBe(true);
    connected.unmount();

    const disconnected = renderHook(() => useDriverConnection(unit({ conectada: false })));
    expect(disconnected.result.current.online).toBe(false);
  });

  it('mirrors the server value into the store the other screens read', () => {
    renderHook(() => useDriverConnection(unit({ conectada: true })));

    expect(useDriverOnlineStore.getState().online).toBe(true);
  });

  it('connect is a REST command and the unit the server answers with is adopted', async () => {
    const answered = unit({ conectada: true, version: 4 });
    mockConectar.mockResolvedValue(answered);
    const onServerUnit = vi.fn();
    const { result } = renderHook(() =>
      useDriverConnection(unit({ conectada: false, version: 3 }), onServerUnit),
    );

    act(() => result.current.connect());

    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(mockConectar).toHaveBeenCalledTimes(1);
    expect(onServerUnit).toHaveBeenCalledWith(answered);
    expect(useDriverOnlineStore.getState().online).toBe(true);
  });

  it('disconnect is a REST command too', async () => {
    const answered = unit({ conectada: false, version: 5 });
    mockDesconectar.mockResolvedValue(answered);
    const onServerUnit = vi.fn();
    const { result } = renderHook(() =>
      useDriverConnection(unit({ conectada: true, version: 4 }), onServerUnit),
    );

    act(() => result.current.disconnect());

    await waitFor(() => expect(onServerUnit).toHaveBeenCalledWith(answered));
    expect(mockDesconectar).toHaveBeenCalledTimes(1);
    expect(mockConectar).not.toHaveBeenCalled();
  });

  it('shows the reason of the server when the unit cannot be disconnected (409)', async () => {
    mockDesconectar.mockRejectedValue(
      new ApiError(
        409,
        'Finaliza el servicio en curso para poder desconectarte.',
        'SOLICITUD_EN_CURSO',
      ),
    );
    const onServerUnit = vi.fn();
    const { result } = renderHook(() =>
      useDriverConnection(unit({ conectada: true }), onServerUnit),
    );

    act(() => result.current.disconnect());

    await waitFor(() => expect(result.current.pending).toBe(false));
    // The unit stays connected: nothing was adopted and nothing was guessed.
    expect(onServerUnit).not.toHaveBeenCalled();
    expect(result.current.online).toBe(true);
    expect(useToastStore.getState().toasts.map((item) => item.message)).toContain(
      'Finaliza el servicio en curso para poder desconectarte.',
    );
  });

  it('ignores a second click while a command is in flight', async () => {
    let resolve: (value: Ambulancia) => void = () => {};
    mockConectar.mockReturnValue(
      new Promise<Ambulancia>((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useDriverConnection(unit({ conectada: false })));

    act(() => result.current.connect());
    act(() => result.current.connect());

    expect(mockConectar).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(unit({ conectada: true }));
    });
  });

  it('declareAvailability is a REST command and the answered unit is adopted', async () => {
    const answered = unit({ conectada: true, estado: 'MAINTENANCE', version: 6 });
    mockDisponibilidad.mockResolvedValue(answered);
    const onServerUnit = vi.fn();
    const { result } = renderHook(() =>
      useDriverConnection(unit({ conectada: true, version: 5 }), onServerUnit),
    );

    act(() => result.current.declareAvailability(false));

    await waitFor(() => expect(onServerUnit).toHaveBeenCalledWith(answered));
    expect(mockDisponibilidad).toHaveBeenCalledWith(false);
    // Out of service is not a disconnection.
    expect(useDriverOnlineStore.getState().online).toBe(true);
  });

  it('declareAvailability does nothing where no server owns the unit', () => {
    const { result } = renderHook(() => useDriverConnection(unit()));

    act(() => result.current.declareAvailability(false));

    expect(mockDisponibilidad).not.toHaveBeenCalled();
  });

  it('keeps the local toggle for a unit that does not carry `conectada`', () => {
    const { result } = renderHook(() => useDriverConnection(unit()));

    expect(result.current.serverManaged).toBe(false);
    expect(result.current.online).toBe(false);

    act(() => result.current.connect());
    expect(result.current.online).toBe(true);
    act(() => result.current.disconnect());
    expect(result.current.online).toBe(false);
    expect(mockConectar).not.toHaveBeenCalled();
    expect(mockDesconectar).not.toHaveBeenCalled();
  });

  it('keeps the local toggle in demo mode even if the unit carries `conectada`', () => {
    vi.stubEnv('VITE_DEMO_MODE', '1');
    const { result } = renderHook(() => useDriverConnection(unit({ conectada: true })));

    expect(result.current.serverManaged).toBe(false);
    expect(result.current.online).toBe(false);

    act(() => result.current.connect());
    expect(result.current.online).toBe(true);
    expect(mockConectar).not.toHaveBeenCalled();
  });
});
