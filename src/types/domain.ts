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
  /**
   * Monotonic version assigned by the server on every write, so a reader can
   * discard stale realtime frames and converge regardless of delivery order.
   * Optional: demo fixtures and the dev relay do not carry it, so an absent
   * version must degrade to the pre-version (last-writer-wins) behaviour instead
   * of breaking those payloads.
   */
  version?: number;
}

export type AmbulanceState = 'AVAILABLE' | 'ASSIGNED' | 'EN_ROUTE' | 'MAINTENANCE';

export interface Ambulancia {
  id: string;
  placa: string;
  /**
   * UI convenience: vehicle model, as the mockup writes it ("Renault Master
   * 2023"). Optional because a unit created in the fleet manager or hydrated
   * from a live frame may not know it yet; the UI omits it instead of inventing.
   */
  modelo?: string;
  /**
   * UI convenience: unit type, as the mockup writes it ("Básica (TAB)").
   * Optional for the same reason as `modelo`.
   */
  tipo?: string;
  estado: AmbulanceState;
  ubicacion: Ubicacion;
  zona: string;
  /** UI convenience: assigned driver display name. */
  driverName: string;
  /**
   * Driver user id the unit is linked to. It is NOT part of the general fleet
   * read-model anymore (FIX3): that projection is visible to every authenticated
   * role, so it must not disclose driver ids. The driver's own unit is read from
   * the server-scoped `GET /api/v1/flota/ambulancias/mia`. This field survives
   * for demo fixtures and the mock fleet resolver only.
   */
  conductorId?: string;
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
  /**
   * UI convenience (not part of the OpenAPI schema): when the winning unit
   * declared its arrival. Set by the registry sync from `request.arrived`, so the
   * coordinator can see the milestone without inventing a domain state.
   */
  llegadaEn?: string;
}

export type TrafficLight = 'RED' | 'AMBER' | 'GREEN' | 'NOT_DECLARED';

/** Grammatical number of an item name, used to agree the need label's verb. */
export type GrammaticalNumber = 'singular' | 'plural';

export interface InventarioItem {
  id: string;
  centroAcopioId: string;
  nombre: string;
  disponible: number;
  requerido: number;
  semaforo: TrafficLight;
  /**
   * UI-only convenience (not part of the OpenAPI schema): the grammatical number
   * of `nombre`, declared by the data so the citizen need label can agree the
   * verb — "Le falta agua potable" vs "Le faltan alimentos". The text alone
   * cannot tell them apart ("gas" is singular and ends in "s", while "casas" is
   * plural and also ends in "s"), so this is declared, never inferred.
   *
   * Optional: the inventory API does NOT expose it (nor `unidad`/`unitDetail`),
   * so an item read from the backend leaves it absent and the UI falls back to
   * the singular form instead of inventing a number.
   */
  grammaticalNumber?: GrammaticalNumber;
  /**
   * UI-only convenience (not part of the OpenAPI schema): the unit the stock is
   * counted in, written literally from the mockup ("bidones", "kits", "cajas",
   * "unidades"). Optional because a live frame may not carry one; when absent the
   * UI shows the bare numbers instead of inventing a unit.
   */
  unidad?: string;
  /**
   * UI-only convenience (not part of the OpenAPI schema): the more specific unit
   * the mockup's c8 quantity stepper writes ("bidones de 5 L"), while the c7 rail
   * keeps the plain `unidad` ("bidones"). Optional: the modal falls back to
   * `unidad` and, with neither, shows the bare number rather than inventing one.
   */
  unitDetail?: string;
}

/**
 * Aid-center organisation type.
 *
 * `CENTRO_AYUDA` and `CENTRO_ACOPIO` mirror the backend contract's
 * `TipoOrganizacion` enum EXACTLY (`arws-inception/contract/openapi.yaml:695`),
 * so this front type stays a faithful mirror of the contract.
 *
 * FRONT-ONLY DEBT — `HOSPITAL` does NOT exist in the contract. It was added for
 * the demo-only map task `odd/tasks/front-hospitales-en-el-mapa.md` (decision
 * FH-1, criterion AC5) so the citizen map can show nearby hospitals before a
 * backend story exists. This is a DELIBERATE, TEMPORARY deviation from the
 * "domain types mirror the contract" rule: `HOSPITAL` comes from the front demo
 * fixtures, NEVER from `GET /api/v1/mapa`. Anyone porting hospitals to the
 * backend MUST add `HOSPITAL` to `TipoOrganizacion` and to
 * `contract/openapi.yaml`, or the value is orphaned.
 */
export type TipoCentroAyuda = 'CENTRO_AYUDA' | 'CENTRO_ACOPIO' | 'HOSPITAL';

/**
 * Active shortage alert of an aid center (contract `AlertaEscasez`,
 * EP-03.F1.US5 / Azure 225). It is NOT a traffic light: the light compares the
 * stock against the item's `requerido` threshold, while this records an unmet
 * DEMAND — a requested amount the center could not dispatch.
 *
 * `faltante` is deliberately NOT a frozen deficit: it is
 * `cantidadSolicitada - disponibleActual`, the CURRENT missing quantity, which
 * shrinks on its own as donations arrive (backend FA-2). The map receives, per
 * center, its WORST active alert and `alertasActivas` as the total count (FA-5).
 */
export interface AlertaEscasez {
  itemId: string;
  nombre: string;
  cantidadSolicitada: number;
  faltante: number;
  creadaEn: string;
}

export interface CentroAyuda {
  id: string;
  nombre: string;
  ubicacion: Ubicacion;
  items: InventarioItem[];
  /**
   * Worst active shortage alert of the center, if any (contract `alerta`,
   * EP-03.F1.US5). OPTIONAL by design (backend FA-7): most centers have none
   * and the backend omits the field from the JSON when it does, so an absent
   * alert must degrade to today's rendering instead of breaking the payload.
   * Distinct from the traffic light — see `AlertaEscasez`.
   */
  alerta?: AlertaEscasez;
  /**
   * How many active shortage alerts the center has (contract `alertasActivas`,
   * EP-03.F1.US5). Optional for the same reason as `alerta`; the marker only
   * carries the worst one, so this count is the detail's hint that more exist.
   */
  alertasActivas?: number;
  /**
   * Organisation type from the backend map read-model. Optional by design
   * (decision FH-2 / criterion AC4): a center that arrives without one — or
   * with an unknown value the mapper refused to carry — behaves exactly as
   * before, drawn and counted as a supply center. See `TipoCentroAyuda` for the
   * front-only `HOSPITAL` debt.
   */
  tipo?: TipoCentroAyuda;
  /**
   * UI-only convenience (not part of the OpenAPI schema): the street address as
   * the mockup's c7 card writes it ("Cl. 145 #91-19"). Demo data — the backend
   * map read-model does not carry one yet — so it stays optional and the UI
   * simply omits the line when the data has no address.
   */
  direccion?: string;
  /**
   * The backend map read-model groups each center under a zone by id (`zonaId`),
   * and the same response carries the zones with that id. The association is
   * preserved so a zone can be resolved on demand (`zoneForCentro`), but the map
   * deliberately does not paint it on selection (U2 / AC-U2). Optional: the demo
   * fixtures declare no zone, so a center without one simply has none.
   */
  zonaId?: string;
}

/**
 * Active zone as returned by `GET /api/v1/mapa` (the backend `mapa` read-model).
 *
 * `ubicacion` is the zone's reference point; `contorno` is the ordered list of
 * vertices that encloses the zone as an AREA. `contorno` stays optional so a
 * zone that arrives without geometry has no footprint instead of an invented
 * one. The map does not paint zones: "zonas afectadas" are point reports (a
 * single incident), and keeping the vertices is what lets an explicit zone layer
 * be built later without losing the backend geometry.
 */
export interface Zona {
  id: string;
  nombre: string;
  ubicacion: Ubicacion;
  /** Ordered polygon vertices; at least three enclose an area. */
  contorno?: Ubicacion[];
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
