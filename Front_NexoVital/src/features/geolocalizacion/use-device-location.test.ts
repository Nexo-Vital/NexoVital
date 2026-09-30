import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeviceLocation } from './use-device-location';

function setGeolocation(value: unknown): void {
  Object.defineProperty(window.navigator, 'geolocation', { value, configurable: true });
}

function setPermissions(value: unknown): void {
  Object.defineProperty(window.navigator, 'permissions', { value, configurable: true });
}

function position(
  latitude: number,
  longitude: number,
  heading: number | null,
): GeolocationPosition {
  return {
    coords: { latitude, longitude, heading },
    timestamp: Date.now(),
  } as GeolocationPosition;
}

describe('useDeviceLocation', () => {
  beforeEach(() => {
    setGeolocation(undefined);
  });

  afterEach(() => {
    cleanup();
    setGeolocation(undefined);
    setPermissions(undefined);
  });

  it('reports unsupported when the insecure context has no geolocation API', () => {
    const { result } = renderHook(() => useDeviceLocation());
    expect(result.current.status).toBe('unsupported');
    expect(result.current.position).toBeNull();
  });

  it('reports prompt until the device answers', () => {
    setGeolocation({ watchPosition: () => 1, clearWatch: () => undefined });
    const { result } = renderHook(() => useDeviceLocation());
    expect(result.current.status).toBe('prompt');
  });

  it('reports granted and follows the watched position', () => {
    const clearWatch = vi.fn();
    const watchPosition = vi.fn((success: PositionCallback) => {
      success(position(4.61, -74.08, 42));
      return 7;
    });
    setGeolocation({ watchPosition, clearWatch });

    const { result, unmount } = renderHook(() => useDeviceLocation());

    expect(result.current.status).toBe('granted');
    expect(result.current.position).toEqual({ lat: 4.61, lng: -74.08 });
    expect(result.current.heading).toBe(42);

    unmount();
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it('reports denied on permission errors', () => {
    setGeolocation({
      watchPosition: (_success: PositionCallback, error: PositionErrorCallback) => {
        error({
          code: 1,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: 'denied',
        } as GeolocationPositionError);
        return 1;
      },
      clearWatch: () => undefined,
    });

    const { result } = renderHook(() => useDeviceLocation());
    expect(result.current.status).toBe('denied');
  });

  it('reports unavailable on non-permission errors', () => {
    setGeolocation({
      watchPosition: (_success: PositionCallback, error: PositionErrorCallback) => {
        error({
          code: 3,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: 'timeout',
        } as GeolocationPositionError);
        return 1;
      },
      clearWatch: () => undefined,
    });

    const { result } = renderHook(() => useDeviceLocation());
    expect(result.current.status).toBe('unavailable');
  });

  it('exposes a labelled simulated position with a computed heading', () => {
    const { result } = renderHook(() => useDeviceLocation());

    act(() => result.current.setSimulatedPosition({ lat: 4.653, lng: -74.06 }));
    expect(result.current.simulated).toBe(true);
    expect(result.current.position).toEqual({ lat: 4.653, lng: -74.06 });
    expect(result.current.heading).toBeNull();

    act(() => result.current.setSimulatedPosition({ lat: 4.66, lng: -74.05 }));
    expect(result.current.heading).not.toBeNull();

    act(() => result.current.clearSimulated());
    expect(result.current.simulated).toBe(false);
    expect(result.current.position).toBeNull();
  });

  it('exposes the live permission state from the Permissions API', async () => {
    const listeners = new Set<() => void>();
    const permissionStatus = {
      state: 'denied' as PermissionState,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    setPermissions({ query: vi.fn().mockResolvedValue(permissionStatus) });
    setGeolocation({ watchPosition: () => 1, clearWatch: () => undefined });

    const { result } = renderHook(() => useDeviceLocation());
    await waitFor(() => expect(result.current.permission).toBe('denied'));

    // A browser-side permission change must reach the hook without a remount.
    permissionStatus.state = 'granted' as PermissionState;
    act(() => {
      listeners.forEach((listener) => {
        listener();
      });
    });
    expect(result.current.permission).toBe('granted');
  });

  it('retry re-arms the watch and clears the previous subscription', () => {
    let nextId = 0;
    const watchPosition = vi.fn(() => {
      nextId += 1;
      return nextId;
    });
    const clearWatch = vi.fn();
    setGeolocation({ watchPosition, clearWatch });

    const { result } = renderHook(() => useDeviceLocation());
    expect(watchPosition).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());

    // One active watch at a time: the old id is cleared before the new request.
    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(watchPosition).toHaveBeenCalledTimes(2);
  });

  it('retry lets a grant that follows update the status', () => {
    let lastSuccess: PositionCallback | null = null;
    setGeolocation({
      watchPosition: (success: PositionCallback) => {
        lastSuccess = success;
        return 1;
      },
      clearWatch: () => undefined,
    });

    const { result } = renderHook(() => useDeviceLocation());
    expect(result.current.status).toBe('prompt');

    act(() => result.current.retry());
    act(() => lastSuccess?.(position(4.6, -74.05, null)));

    expect(result.current.status).toBe('granted');
    expect(result.current.position).toEqual({ lat: 4.6, lng: -74.05 });
  });
});
