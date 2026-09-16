import { useEffect } from 'react';
import { DESTINATIONS, type RealtimePort } from '@/shared/realtime';
import type { Emergencia, EmergencyLevel, EmergencyStatus } from '@/types/domain';
import { useEmergencyStore } from './emergency-store';

const LEVELS: EmergencyLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUSES: EmergencyStatus[] = ['REPORTED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEmergencia(value: unknown): value is Emergencia {
  if (!isRecord(value)) {
    return false;
  }
  const ubicacion = value.ubicacion;
  return (
    typeof value.id === 'string' &&
    typeof value.zonaId === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.nivel === 'string' &&
    LEVELS.includes(value.nivel as EmergencyLevel) &&
    typeof value.estado === 'string' &&
    STATUSES.includes(value.estado as EmergencyStatus) &&
    isRecord(ubicacion) &&
    typeof ubicacion.lat === 'number' &&
    typeof ubicacion.lng === 'number'
  );
}

/**
 * Subscribes to /topic/emergencias and UPSERTS every reported emergency, so an
 * event created on one client appears on every connected client's map.
 * Accepts both the `emergency.upsert` envelope and a bare emergency object.
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
      if (payload.type === 'emergency.upsert' && isEmergencia(payload.emergency)) {
        upsert(payload.emergency);
        return;
      }
      if (isEmergencia(payload)) {
        upsert(payload);
      }
    });
  }, [port, upsert]);
}
