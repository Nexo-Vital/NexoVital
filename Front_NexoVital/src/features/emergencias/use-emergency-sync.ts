import { useEffect } from 'react';
import { DESTINATIONS, type RealtimePort } from '@/shared/realtime';
import { useEmergencyStore } from './emergency-store';
import { fromWireEmergency } from './emergency-wire';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Subscribes to /topic/emergencias and UPSERTS every reported emergency, so an
 * event created on one client appears on every connected client's map.
 * Accepts both the `emergency.upsert` envelope and a bare emergency object.
 *
 * Validation goes through `fromWireEmergency`, so it accepts the backend's
 * Spanish enums (`ALTO`/`REGISTRADA`) and a `null` zonaId, while still accepting
 * the already-normalized (demo) payloads the store holds.
 */
export function useEmergencySync(port: RealtimePort | null): void {
  const upsert = useEmergencyStore((state) => state.upsert);

  useEffect(() => {
    if (!port) {
      return;
    }
    return port.subscribe(DESTINATIONS.emergencias, (payload) => {
      if (!isRecord(payload)) {
        return;
      }
      if (payload.type === 'emergency.upsert') {
        const emergency = fromWireEmergency(payload.emergency);
        if (emergency) {
          upsert(emergency);
        }
        return;
      }
      const emergency = fromWireEmergency(payload);
      if (emergency) {
        upsert(emergency);
      }
    });
  }, [port, upsert]);
}
