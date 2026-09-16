/**
 * Nexo Vital domain types.
 *
 * Field names mirror contract/openapi.yaml (Spanish) so payloads map 1:1.
 * Enum VALUES are normalized to English for the CRUE UI. Contract mapping:
 *
 *   EmergencyLevel   LOW | MEDIUM | HIGH | CRITICAL
 *                    <- BAJO | MEDIO | ALTO | CRITICO
 *   EmergencyStatus  REPORTED | IN_PROGRESS | ON_HOLD | RESOLVED | CLOSED
 *                    <- REGISTRADA | EN_ATENCION | EN_ESPERA | RESUELTA | CERRADA
 *   AmbulanceState   AVAILABLE | ASSIGNED | EN_ROUTE | MAINTENANCE
 *                    <- DISPONIBLE | EN_MISION | EN_RUTA | MANTENIMIENTO
 *   RequestState     PENDING | ASSIGNED | CONFIRMED | TAKEN | REJECTED | TIMEOUT
 *                    <- PENDIENTE | ASIGNADA | CONFIRMADA | TOMADA | RECHAZADA | TIMEOUT
 *   TrafficLight     RED | AMBER | GREEN | NOT_DECLARED
 *                    <- ROJO | AMARILLO | VERDE (NOT_DECLARED is UI-only)
 */

export type RolUsuario =
  | 'CIUDADANO'
  | 'ADMIN_PLATAFORMA'
  | 'ADMIN_CENTRO_AYUDA'
  | 'ADMIN_ACOPIO'
  | 'CONDUCTOR';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
}

export interface Ubicacion {
  lat: number;
  lng: number;
}

export type EmergencyLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type EmergencyStatus = 'REPORTED' | 'IN_PROGRESS' | 'ON_HOLD' | 'RESOLVED' | 'CLOSED';

export interface Emergencia {
  id: string;
  ubicacion: Ubicacion;
  nivel: EmergencyLevel;
  estado: EmergencyStatus;
  descripcion?: string;
  /** UI grouping key used by the registry; not part of the OpenAPI schema. */
  zonaId: string;
  createdAt: string;
}

export type AmbulanceState = 'AVAILABLE' | 'ASSIGNED' | 'EN_ROUTE' | 'MAINTENANCE';

export interface Ambulancia {
  id: string;
  placa: string;
  estado: AmbulanceState;
  ubicacion: Ubicacion;
  zona: string;
  /** UI convenience: assigned driver display name. */
  driverName: string;
  /** UI convenience: position source once the unit reports over /topic/flota. */
  source?: 'device' | 'simulated';
  /** UI convenience: last reported heading, degrees clockwise from north. */
  heading?: number | null;
}

export type RequestState = 'PENDING' | 'ASSIGNED' | 'CONFIRMED' | 'TAKEN' | 'REJECTED' | 'TIMEOUT';

export interface SolicitudAmbulancia {
  id: string;
  emergenciaId: string;
  estado: RequestState;
  centroAyudaId: string;
  zonaId: string;
  /** UI label for the registry row, e.g. "Cardiac arrest". */
  tipo: string;
  solicitadaEn: string;
  timeoutEn: string;
  ambulanciasNotificadas: string[];
  /**
   * UI convenience derived from `ambulanciasNotificadas.length`. The coordinator
   * never picks a winner; this is only the number of units the center notified.
   */
  notifiedCount: number;
  /** Winning unit once the request is resolved. Never chosen by the client. */
  ambulanciaAsignadaId?: string | null;
}

export type TrafficLight = 'RED' | 'AMBER' | 'GREEN' | 'NOT_DECLARED';

export interface InventarioItem {
  id: string;
  centroAcopioId: string;
  nombre: string;
  disponible: number;
  requerido: number;
  semaforo: TrafficLight;
}

export interface CentroAyuda {
  id: string;
  nombre: string;
  ubicacion: Ubicacion;
  items: InventarioItem[];
}

export interface BitacoraEvento {
  id: string;
  tipo: string;
  entidadTipo: string;
  entidadId: string;
  actorId: string;
  timestamp: string;
}

/** WebSocket channel health shown in the app shell. */
export type ChannelState = 'CONNECTED' | 'DISCONNECTED' | 'STALE';
