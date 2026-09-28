import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESTINATIONS } from '@/shared/realtime';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import { useAlertasEscasezSync } from './use-alertas-escasez-sync';

const CENTRO_ID = '22222222-2222-4222-8222-222222222222';

/** A wire alert exactly as `/topic/alerts` publishes it the backend. */
function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    centroAcopioId: CENTRO_ID,
    itemId: '11111111-1111-4111-8111-111111111111',
    nombre: 'Agua potable',
    cantidadSolicitada: 8,
    disponibleActual: 5,
    faltante: 3,
    creadaEn: '2026-09-28T12:00:00Z',
    ...overrides,
  };
}

describe('useAlertasEscasezSync', () => {
  afterEach(cleanup);

  it('notifies the caller on a shortage-alert frame, so it can re-read the map', () => {
    const port = new FakeRealtimePort();
    const onAlertaChange = vi.fn();
    renderHook(() => useAlertasEscasezSync(port, onAlertaChange));

    act(() => port.emit(DESTINATIONS.alertas, wire()));

    expect(onAlertaChange).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed frames instead of triggering a blind re-read', () => {
    const port = new FakeRealtimePort();
    const onAlertaChange = vi.fn();
    renderHook(() => useAlertasEscasezSync(port, onAlertaChange));

    act(() => port.emit(DESTINATIONS.alertas, { nombre: 'Agua potable' }));
    act(() => port.emit(DESTINATIONS.alertas, null));

    expect(onAlertaChange).not.toHaveBeenCalled();
  });

  it('does nothing without a port (demo build never constructs a transport)', () => {
    const onAlertaChange = vi.fn();
    renderHook(() => useAlertasEscasezSync(null, onAlertaChange));

    expect(onAlertaChange).not.toHaveBeenCalled();
  });
});
