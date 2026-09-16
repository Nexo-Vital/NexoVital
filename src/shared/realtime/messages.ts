import type {
  AmbulanceState,
  Ambulancia,
  Emergencia,
  EmergencyLevel,
  Ubicacion,
} from '../../types/domain';

/**
 * Message contract shared by every realtime transport.
 *
 * Destinations mirror the STOMP contract in `src/services/stompClient.ts`:
 *   /topic/emergencias  - new / updated emergency
 *   /topic/flota       - live fleet positions
 *   /topic/suministros - inventory + traffic light
 *   /queue/solicitudes - broadcast requests (driver inbox)
 */
export const DESTINATIONS = {
  flota: '/topic/flota',
  emergencias: '/topic/emergencias',
  suministros: '/topic/suministros',
  solicitudes: '/queue/solicitudes',
} as const;

export type Destination = (typeof DESTINATIONS)[keyof typeof DESTINATIONS];

/**
 * Path where the realtime WebSocket relay is mounted. In dev it is served by
 * `vite-plugin-dev-realtime.ts`; in production by the `RealtimeRoom` Durable
 * Object on the same Worker. Both speak the same relay protocol.
 */
export const REALTIME_PATH = '/realtime';

/**
 * Every realtime message is a JSON envelope `{ destination, payload }`. A real
 * STOMP adapter maps the same envelope onto a STOMP frame body.
 */
export interface RealtimeEnvelope<T = unknown> {
  destination: string;
  payload: T;
}

/** A unit reporting its live position on /topic/flota. */
export interface LiveUnitPayload {
  ambulanceId: string;
  ubicacion: Ubicacion;
  estado: AmbulanceState;
  heading: number | null;
  source: 'device' | 'simulated';
}

/**
 * Full unit snapshot published by the CRUE fleet manager (create or update).
 * Consumers UPSERT: an unknown `ambulanceId` is created, a known one is merged.
 */
export interface FleetUnitUpsertPayload {
  type: 'fleet.upsert';
  unit: Ambulancia;
}

/** Fleet unit removal published by the CRUE fleet manager. */
export interface FleetUnitDeletePayload {
  type: 'fleet.delete';
  ambulanceId: string;
}

/**
 * Every payload that can arrive on /topic/flota.
 *
 * `LiveUnitPayload` has no discriminant, so consumers must check for `type`
 * first; anything without it is a legacy live-position frame.
 */
export type FleetPayload = LiveUnitPayload | FleetUnitUpsertPayload | FleetUnitDeletePayload;

/**
 * New or updated emergency published on /topic/emergencias. Consumers UPSERT:
 * an unknown `emergency.id` is created, a known one is merged in place.
 */
export interface EmergencyUpsertPayload {
  type: 'emergency.upsert';
  emergency: Emergencia;
}

/**
 * Request lifecycle on /queue/solicitudes.
 *
 * C2 (domain rule): a request is BROADCAST to N units and the FIRST accept wins,
 * decided server-side. The client only ever PUBLISHES an accept bid; it never
 * decides or announces a winner on its own. `request.taken` and
 * `request.already-taken` are server-originated (the dev relay fakes the
 * arbiter until the backend exists).
 *
 * Direct mode is a different CAD pattern: a request is addressed to ONE unit,
 * so there is no race. The arbiter still enforces "only the target can accept"
 * so a stale client cannot steal a request that was never offered to it.
 */
export type SolicitudMode = 'broadcast' | 'direct';

export type SolicitudType =
  | 'solicitud.broadcast'
  | 'solicitud.direct'
  | 'solicitud.accept'
  | 'solicitud.reject'
  | 'request.taken'
  | 'request.already-taken'
  | 'request.rejected';

export interface SolicitudBroadcastPayload {
  type: 'solicitud.broadcast';
  requestId: string;
  emergenciaId: string;
  zonaId: string;
  tipo: string;
  nivel: EmergencyLevel;
  escena: Ubicacion;
  /** ISO timestamp when the accept window closes. */
  timeoutEn: string;
  notificadas: string[];
  /** Delivery mode. Absent on legacy frames, which are treated as broadcast. */
  mode?: SolicitudMode;
  /** Direct mode only: the single unit allowed to accept. */
  targetAmbulanceId?: string;
  /** UI convenience: number of units notified. */
  notifiedCount?: number;
  /** Accept window length in milliseconds. */
  timeoutMs?: number;
}

/** Direct-mode request addressed to exactly one unit. */
export interface SolicitudDirectPayload {
  type: 'solicitud.direct';
  requestId: string;
  emergenciaId: string;
  zonaId: string;
  tipo: string;
  nivel: EmergencyLevel;
  escena: Ubicacion;
  timeoutEn: string;
  notificadas: string[];
  mode: 'direct';
  targetAmbulanceId: string;
  notifiedCount: number;
  timeoutMs: number;
}

export interface SolicitudAcceptPayload {
  type: 'solicitud.accept';
  requestId: string;
  ambulanceId: string;
}

export interface SolicitudRejectPayload {
  type: 'solicitud.reject';
  requestId: string;
  ambulanceId: string;
  reason?: string;
}

export interface RequestTakenPayload {
  type: 'request.taken';
  requestId: string;
  winner: string;
}

export interface RequestAlreadyTakenPayload {
  type: 'request.already-taken';
  requestId: string;
  winner: string;
  rejected: string;
}

/** Arbiter rejection of an accept the requester was not allowed to send. */
export interface RequestRejectedPayload {
  type: 'request.rejected';
  requestId: string;
  rejected: string;
  reason: 'not-targeted' | 'rejected';
}

export type SolicitudPayload =
  | SolicitudBroadcastPayload
  | SolicitudDirectPayload
  | SolicitudAcceptPayload
  | SolicitudRejectPayload
  | RequestTakenPayload
  | RequestAlreadyTakenPayload
  | RequestRejectedPayload;
