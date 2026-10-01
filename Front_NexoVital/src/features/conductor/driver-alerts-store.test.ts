import { beforeEach, describe, expect, it } from 'vitest';
import { type DriverAlert, useDriverAlertsStore } from './driver-alerts-store';

const ALERT: DriverAlert = {
  requestId: 'REQ-1',
  tipo: 'Trauma',
  nivel: 'HIGH',
  escena: { lat: 4.628, lng: -74.148 },
  timeoutEn: new Date(Date.now() + 45_000).toISOString(),
};

function reset() {
  useDriverAlertsStore.setState({ pending: [], pendingRequests: 0, focusRequestId: null });
}

describe('driver-alerts-store', () => {
  beforeEach(reset);

  it('starts with no pending offer and no focus', () => {
    const state = useDriverAlertsStore.getState();

    expect(state.pending).toEqual([]);
    expect(state.pendingRequests).toBe(0);
    expect(state.focusRequestId).toBeNull();
  });

  it('setPending stores the offers and keeps pendingRequests in sync', () => {
    useDriverAlertsStore.getState().setPending([ALERT]);

    expect(useDriverAlertsStore.getState().pending).toEqual([ALERT]);
    expect(useDriverAlertsStore.getState().pendingRequests).toBe(1);

    useDriverAlertsStore.getState().setPending([]);

    expect(useDriverAlertsStore.getState().pending).toEqual([]);
    expect(useDriverAlertsStore.getState().pendingRequests).toBe(0);
  });

  it('focusRequest and clearFocus drive the focus signal', () => {
    useDriverAlertsStore.getState().focusRequest('REQ-1');

    expect(useDriverAlertsStore.getState().focusRequestId).toBe('REQ-1');

    useDriverAlertsStore.getState().clearFocus();

    expect(useDriverAlertsStore.getState().focusRequestId).toBeNull();
  });

  it('drops a focus for a request that is no longer pending', () => {
    useDriverAlertsStore.getState().setPending([ALERT]);
    useDriverAlertsStore.getState().focusRequest('REQ-1');

    useDriverAlertsStore.getState().setPending([]);

    expect(useDriverAlertsStore.getState().focusRequestId).toBeNull();
  });

  it('keeps a focus that is still pending when the list refreshes', () => {
    useDriverAlertsStore.getState().setPending([ALERT]);
    useDriverAlertsStore.getState().focusRequest('REQ-1');

    useDriverAlertsStore.getState().setPending([{ ...ALERT, tipo: 'Trauma actualizado' }]);

    expect(useDriverAlertsStore.getState().focusRequestId).toBe('REQ-1');
  });
});
