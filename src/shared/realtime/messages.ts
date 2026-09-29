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
 * Destinations mirror the STOMP contract served by the backend (`/ws`), wired
 * by `StompRealtimeAdapter`:
 *   /topic/emergencias       - new / updated emergency
 *   /topic/flota             - live fleet positions
 *   /topic/suministros       - inventory + traffic light
 *   /topic/alerts            - shortage alerts raised by a rejected dispatch
 *   /user/queue/solicitudes  - per-user request inbox (driver broadcasts)
 *   /topic/map.events        - map element lifecycle (zones and aid centers)
 *
 * The request inbox is a USER destination, not a shared `/queue`: with Spring's
 * simple broker a `/queue` with N subscribers delivers round-robin to ONE, which
 * would break the broadcast. The backend `flota` module publishes one copy per
 * notified unit with `convertAndSendToUser` (D-F1), so a driver subscribes to
 * `/user/queue/solicitudes` and receives only its own copy.
 */
export const DESTINATIONS = {
  flota: '/topic/flota',
  emergencias: '/topic/emergencias',
  suministros: '/topic/suministros',
  alertas: '/topic/alerts',
  solicitudes: '/user/queue/solicitudes',
  mapa: '/topic/map.events',
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

/** Class of a map element carried on /topic/map.events. */
export type MapaElementoClase = 'ZONA' | 'CENTRO';

/**
 * A map element as the backend publishes it on /topic/map.events: the same shape
 * the map already serves over REST (`GET /api/v1/mapa`). The optional fields are
 * class-specific — a ZONA only carries `contorno`, a CENTRO only carries `zonaId`
 * and `tipo` — so the producer fills only the ones its class has.
 */
export interface MapaElementoPayload {
  clase: MapaElementoClase;
  id: string;
  nombre: string;
  ubicacion: Ubicacion;
  /** ZONA only: ordered polygon vertices that draw the zone as an area. */
  contorno?: Ubicacion[];
  /** CENTRO only: id of the zone the center belongs to. JSON `null` when it has none. */
  zonaId?: string | null;
  /** CENTRO only: center type as the backend returns it. */
  tipo?: string;
}

/**
 * Map element created or updated on /topic/map.events. Consumers UPSERT: an
 * unknown `clase:id` is created, a known one is merged in place (the same rule
 * fleet and emergency frames follow).
 */
export interface MapaElementoUpsertPayload {
  type: 'mapa.elemento.upsert';
  elemento: MapaElementoPayload;
}

/** Map element removal published on /topic/map.events. */
export interface MapaElementoDeletePayload {
  type: 'mapa.elemento.delete';
  clase: MapaElementoClase;
  id: string;
}

/** Every payload that can arrive on /topic/map.events. */
export type MapaPayload = MapaElementoUpsertPayload | MapaElementoDeletePayload;

/**
 * Traffic-light literal as the backend speaks it (Spanish). `types/domain.ts`
 * normalizes the VALUES to English, so this is the translation edge shared by
 * the REST read (`GET .../inventario`) and the realtime push.
 */
export type SemaforoWire = 'ROJO' | 'AMARILLO' | 'VERDE';

/**
 * Inventory item published on /topic/suministros. It is the SAME projection the
 * backend returns over REST (`ItemInventarioDto`): identity, name, available and
 * required stock, and the traffic light. Consumers UPSERT by `id`; an unknown id
 * is created, a known one is merged in place.
 *
 * There is no envelope: the backend publishes the bare projection
 * (`InventarioPushListener` calls `pushPort.publicar(DESTINO_SUMINISTROS, item)`).
 */
export interface ItemInventarioPayload {
  id: string;
  centroAcopioId: string;
  nombre: string;
  disponible: number;
  requerido: number;
  semaforo: SemaforoWire;
}

/**
 * Shortage alert published on /topic/alerts when a rejected dispatch CREATES or
 * UPDATES the demand of a center's item. It mirrors the backend projection
 * `AlertaEscasezPushListener.AlertaEscasezPushPayload`: resource, demand, the
 * stock seen at rejection and the current missing quantity (`faltante`).
 *
 * The alert's activity is a function of the stock and the map only exposes its
 * alert projection through `GET /api/v1/mapa`, so this channel does not carry
 * the center's read-model: a consumer uses the frame as the signal to re-read
 * the map. There is no envelope: the backend publishes the bare projection
 * (`AlertaEscasezPushListener` calls `pushPort.publicar(DESTINO_ALERTAS, ...)`).
 */
export interface AlertaEscasezPayload {
  centroAcopioId: string;
  itemId: string;
  nombre: string;
  cantidadSolicitada: number;
  disponibleActual: number;
  faltante: number;
  creadaEn: string;
}

/**
 * Request lifecycle on /user/queue/solicitudes.
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
 *
 * The requester may also WITHDRAW an open request: `solicitud.cancel` drops the
 * pending request server-side and fans out `request.cancelled`, so every driver
 * inbox stops offering a mission nobody is asking for anymore.
 */
export type SolicitudMode = 'broadcast' | 'direct';

export type SolicitudType =
  | 'solicitud.broadcast'
  | 'solicitud.direct'
  | 'solicitud.cancel'
  | 'solicitud.accept'
  | 'solicitud.reject'
  | 'solicitud.llegada'
  | 'solicitud.confirmar'
  | 'request.taken'
  | 'request.already-taken'
  | 'request.rejected'
  | 'request.cancelled'
  | 'request.arrived'
  | 'request.confirmed'
  | 'request.expired'
  | 'request.closed';

export interface SolicitudBroadcastPayload {
  type: 'solicitud.broadcast';
  requestId: string;
  emergenciaId: string;
  zonaId: string;
  tipo: string;
  /**
   * Emergency severity. Optional on purpose: a request raised by a citizen has
   * no triage behind it, so it carries no level and the driver card shows
   * "Sin clasificar" instead of an invented severity. A request created from the
   * CRUE always carries the emergency's real level.
   */
  nivel?: EmergencyLevel;
  /**
   * Requester scene. Optional on purpose: the backend `flota` push carries no
   * coordinates (see `SolicitudWireFrame`), so the front resolves them from the
   * emergency store when it can and leaves the field absent when it cannot,
   * instead of inventing a point on the map.
   */
  escena?: Ubicacion;
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
  /** Optional for the same reason as the broadcast payload: not a wire field. */
  escena?: Ubicacion;
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

/** The requester withdraws an open request (client -> relay). */
export interface SolicitudCancelPayload {
  type: 'solicitud.cancel';
  requestId: string;
}

/** The relay acknowledged the withdrawal; every client drops the request. */
export interface RequestCancelledPayload {
  type: 'request.cancelled';
  requestId: string;
}

/**
 * The winning driver declares arrival at the scene (client -> relay). Only the
 * recorded winner may send it; the relay validates and fans the arrival out.
 */
export interface SolicitudLlegadaPayload {
  type: 'solicitud.llegada';
  requestId: string;
  ambulanceId: string;
}

/** The relay acknowledged the arrival; every client reflects it once. */
export interface RequestArrivedPayload {
  type: 'request.arrived';
  requestId: string;
  ambulanceId: string;
}

/** The citizen confirms the ambulance is with them (client -> relay). */
export interface SolicitudConfirmarPayload {
  type: 'solicitud.confirmar';
  requestId: string;
}

/** The relay acknowledged the confirmation; the request is closed. */
export interface RequestConfirmedPayload {
  type: 'request.confirmed';
  requestId: string;
}

/**
 * The request expired with no winner (backend `TIMEOUT`). It is a
 * WHOLE-REQUEST state, not a per-unit decline: the request is no longer active,
 * so every consumer must drop it instead of offering a mission nobody asked for
 * anymore.
 */
export interface RequestExpiredPayload {
  type: 'request.expired';
  requestId: string;
}

/**
 * The attended service was finished (backend `TOMADA`). The request is closed
 * and no longer active; it must not linger as a stale card.
 */
export interface RequestClosedPayload {
  type: 'request.closed';
  requestId: string;
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
  /**
   * `not-targeted`: a direct request accepted by a unit other than its target.
   * `not-notified`: a broadcast accepted by a unit that was never notified.
   * `rejected`: the addressed unit declined the request.
   */
  reason: 'not-targeted' | 'not-notified' | 'rejected';
}

export type SolicitudPayload =
  | SolicitudBroadcastPayload
  | SolicitudDirectPayload
  | SolicitudAcceptPayload
  | SolicitudCancelPayload
  | SolicitudRejectPayload
  | SolicitudLlegadaPayload
  | SolicitudConfirmarPayload
  | RequestTakenPayload
  | RequestAlreadyTakenPayload
  | RequestRejectedPayload
  | RequestCancelledPayload
  | RequestArrivedPayload
  | RequestConfirmedPayload
  | RequestExpiredPayload
  | RequestClosedPayload;

/**
 * Request lifecycle literal as the backend `flota` module speaks it.
 * Mirrors `EstadoSolicitud` (`domain/enums/EstadoSolicitud.java`) exactly.
 */
export type EstadoSolicitudWire =
  | 'PENDIENTE'
  | 'ASIGNADA'
  | 'CONFIRMADA'
  | 'TOMADA'
  | 'RECHAZADA'
  | 'TIMEOUT'
  | 'CANCELADA';

/**
 * Request frame the backend `flota` module pushes to `/user/queue/solicitudes`.
 *
 * It is the JSON of `FlotaPushListener.SolicitudPushPayload`:
 * `{solicitudId, ubicacion, emergenciaId, zonaId, estado, ambulanciasNotificadas,
 * ambulanciaAsignadaId}`. Two things set it apart from the front's
 * `SolicitudPayload` union:
 *
 *   - it has NO `type` discriminant: the lifecycle is in `estado`;
 *   - it carries no request type label and no accept deadline. The front
 *     resolves them from the emergency (`emergenciaId`) when it has it, and
 *     degrades honestly when it does not.
 *
 * `ubicacion` is the request's own pickup point and travels on the creation
 * frame; the later lifecycle frames send it `null`. `emergenciaId` and `zonaId`
 * are nullable: a standalone citizen request has neither. `fromWireSolicitud`
 * validates this shape and returns null on a malformed frame; the union is then
 * built by `solicitudFrameFromWire`.
 */
export interface SolicitudWireFrame {
  solicitudId: string;
  /** Optional emergency reference; null for a standalone request. */
  emergenciaId: string | null;
  /** Optional zone context; null when the request declares none. */
  zonaId: string | null;
  estado: EstadoSolicitudWire;
  ambulanciasNotificadas: string[];
  /** Winner unit, or null while the request is still PENDIENTE. */
  ambulanciaAsignadaId: string | null;
  /** Pickup point on the creation frame; null on the lifecycle frames. */
  ubicacion: Ubicacion | null;
  /**
   * Arrival milestone: true on the request-level push the winning unit's
   * arrival emits. Arrival is NOT a lifecycle state (the request stays
   * ASIGNADA), so it travels as this flag and `solicitudFrameFromWire` turns it
   * into `request.arrived`. Absent on every other frame.
   */
  llegada?: boolean;
}
