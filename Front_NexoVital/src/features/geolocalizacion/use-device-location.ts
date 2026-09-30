import { useCallback, useEffect, useRef, useState } from 'react';
import { bearingDegrees } from '@/lib/geo';
import type { Ubicacion } from '@/types/domain';

export type GeolocationStatus = 'unsupported' | 'prompt' | 'granted' | 'denied' | 'unavailable';

/**
 * Real browser permission state for geolocation. `unknown` is the honest
 * fallback when `navigator.permissions` is unavailable: the app then cannot
 * tell a dismissal (`prompt`) from a block (`denied`).
 */
export type LocationPermissionState = PermissionState | 'unknown';

export interface DeviceLocationState {
  /** Effective position: the device feed, or the simulated override when set. */
  position: Ubicacion | null;
  heading: number | null;
  status: GeolocationStatus;
  /**
   * Live permission state from the Permissions API. Unlike `status`, it tells a
   * dismissed prompt (`prompt`, the native dialog can be shown again) from a
   * block (`denied`, only browser settings can undo it).
   */
  permission: LocationPermissionState;
  /** True when `position` comes from the "Simular posición" control. */
  simulated: boolean;
  /** Move the simulated marker (used by tap-to-move and drag). */
  setSimulatedPosition: (position: Ubicacion) => void;
  /** Drop the simulated override and fall back to the device feed. */
  clearSimulated: () => void;
  /**
   * Ask for the location again after a denial or a dismissed prompt. Re-arms
   * the watch (the previous one is cleared first) and puts `status` back to
   * `prompt` while the new request is in flight.
   */
  retry: () => void;
}

/** Bogotá center: where the simulated marker starts. */
export const SIMULATED_START: Ubicacion = { lat: 4.653, lng: -74.06 };

/** Spanish explanation shown when the browser has no geolocation. */
export const INSECURE_CONTEXT_MESSAGE =
  'La ubicación necesita HTTPS. Ejecuta `npm run dev:https` y acepta el certificado en el teléfono.';

/**
 * Insecure origins do not expose `navigator.geolocation` at all, so a missing
 * API is the reliable signal for "not a secure context". `window.isSecureContext
 * === false` is checked first to make that explicit.
 */
function detectInitialStatus(): GeolocationStatus {
  if (typeof window === 'undefined') {
    return 'unsupported';
  }
  if (window.isSecureContext === false) {
    return 'unsupported';
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'unsupported';
  }
  return 'prompt';
}

function normalizeHeading(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * Wraps `navigator.geolocation.watchPosition` and adds a simulated fallback so
 * the feature is demoable on desktop or without GPS. The simulated source is
 * always reported via `simulated`, so the UI can label it clearly.
 */
export function useDeviceLocation(): DeviceLocationState {
  const [status, setStatus] = useState<GeolocationStatus>(detectInitialStatus);
  const [permission, setPermission] = useState<LocationPermissionState>('unknown');
  const [devicePosition, setDevicePosition] = useState<Ubicacion | null>(null);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [simulatedPosition, setSimulatedPosition] = useState<Ubicacion | null>(null);
  const [simulatedHeading, setSimulatedHeading] = useState<number | null>(null);
  const simulatedRef = useRef<Ubicacion | null>(null);
  // Bumped by `retry()`: the watcher effect depends on it, so React clears the
  // previous watch before opening a new one (single active subscription).
  const [attempt, setAttempt] = useState(0);

  const supported = status !== 'unsupported';

  // The Permissions API is the only source that separates "the user dismissed
  // the dialog" (prompt) from "the user blocked it" (denied). Re-read it on
  // window focus because changing a site permission happens in browser chrome,
  // outside the page; `change` keeps it live without polling.
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.permissions?.query !== 'function') {
      return;
    }
    let cancelled = false;
    let current: PermissionStatus | null = null;

    const apply = (state: LocationPermissionState) => {
      if (!cancelled) {
        setPermission(state);
      }
    };
    const onChange = () => {
      if (current) {
        apply(current.state);
      }
    };
    const refresh = () => {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((result) => {
          if (cancelled) {
            return;
          }
          if (current && current !== result) {
            current.removeEventListener('change', onChange);
          }
          current = result;
          result.addEventListener('change', onChange);
          apply(result.state);
        })
        .catch(() => apply('unknown'));
    };

    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      current?.removeEventListener('change', onChange);
    };
  }, []);

  // `attempt` is the retry trigger: bumping it re-arms the watch. It is on
  // purpose not read inside the effect, so the linter cannot see the dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the retry trigger
  useEffect(() => {
    if (!supported || typeof navigator === 'undefined' || !navigator.geolocation) {
      return;
    }
    const geolocation = navigator.geolocation;
    const watchId = geolocation.watchPosition(
      (position) => {
        setStatus('granted');
        setDevicePosition({ lat: position.coords.latitude, lng: position.coords.longitude });
        setDeviceHeading(normalizeHeading(position.coords.heading));
      },
      (error) => {
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => {
      geolocation.clearWatch(watchId);
    };
  }, [supported, attempt]);

  const retry = useCallback(() => {
    // Back to `prompt` while the new request runs: the previous denial is no
    // longer the current answer once the user explicitly asks again.
    setStatus((current) => (current === 'unsupported' ? current : 'prompt'));
    setAttempt((current) => current + 1);
  }, []);

  const setSimulated = useCallback((next: Ubicacion) => {
    const previous = simulatedRef.current;
    if (previous && (previous.lat !== next.lat || previous.lng !== next.lng)) {
      setSimulatedHeading(bearingDegrees(previous, next));
    }
    simulatedRef.current = next;
    setSimulatedPosition(next);
  }, []);

  const clearSimulated = useCallback(() => {
    simulatedRef.current = null;
    setSimulatedPosition(null);
    setSimulatedHeading(null);
  }, []);

  const simulated = simulatedPosition !== null;

  return {
    position: simulatedPosition ?? devicePosition,
    heading: simulated ? simulatedHeading : deviceHeading,
    status,
    permission,
    simulated,
    setSimulatedPosition: setSimulated,
    clearSimulated,
    retry,
  };
}
