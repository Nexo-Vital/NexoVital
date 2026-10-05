import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimePort } from '@/test/fake-realtime-port';
import { useRealtimeReconnect } from './use-realtime-reconnect';

describe('useRealtimeReconnect', () => {
  afterEach(cleanup);

  it('does not fire on the first connection', () => {
    const port = new FakeRealtimePort();
    port.state = 'STALE';
    const onReconnect = vi.fn();
    renderHook(() => useRealtimeReconnect(port, onReconnect));

    act(() => port.setState('CONNECTED'));

    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('does not fire for a port that is already connected on mount', () => {
    const port = new FakeRealtimePort();
    const onReconnect = vi.fn();
    renderHook(() => useRealtimeReconnect(port, onReconnect));

    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('fires once each time the channel comes back after a drop', () => {
    const port = new FakeRealtimePort();
    const onReconnect = vi.fn();
    renderHook(() => useRealtimeReconnect(port, onReconnect));

    act(() => port.setState('STALE'));
    expect(onReconnect).not.toHaveBeenCalled();

    act(() => port.setState('CONNECTED'));
    expect(onReconnect).toHaveBeenCalledTimes(1);

    act(() => port.setState('DISCONNECTED'));
    act(() => port.setState('CONNECTED'));
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it('is disabled with a null port and stops after unmount', () => {
    const onReconnect = vi.fn();
    renderHook(() => useRealtimeReconnect(null, onReconnect));

    const port = new FakeRealtimePort();
    const { unmount } = renderHook(() => useRealtimeReconnect(port, onReconnect));
    unmount();
    act(() => port.setState('STALE'));
    act(() => port.setState('CONNECTED'));

    expect(onReconnect).not.toHaveBeenCalled();
  });
});
