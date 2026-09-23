import { useCallback, useEffect, useRef, useState } from 'react';
import { bearingDegrees } from '@/lib/geo';
import type { Ubicacion } from '@/types/domain';

export type GeolocationStatus = 'unsupported' | 'prompt' | 'granted' | 'denied' | 'unavailable';

export interface DeviceLocationState {
  /** Effective position: the device feed, or the simulated override when set. */
  position: Ubicacion | null;
  heading: number | null;
  status: GeolocationStatus;
  /** True when `position` comes from the "Simular posición" control. */
  simulated: boolean;
  /** Move the simulated marker (used by tap-to-move and drag). */
  setSimulatedPosition: (position: Ubicacion) => void;
  /** Drop the simulated override and fall back to the device feed. */
  clearSimulated: () => void;
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
  const [devicePosition, setDevicePosition] = useState<Ubicacion | null>(null);
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [simulatedPosition, setSimulatedPosition] = useState<Ubicacion | null>(null);
  const [simulatedHeading, setSimulatedHeading] = useState<number | null>(null);
  const simulatedRef = useRef<Ubicacion | null>(null);

  const supported = status !== 'unsupported';

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
  }, [supported]);

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
    simulated,
    setSimulatedPosition: setSimulated,
    clearSimulated,
  };
}
