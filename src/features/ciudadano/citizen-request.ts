import { SOLICITUD_TIMEOUT_MS } from '@/features/solicitudes/solicitud-form';
import { formatCountdown } from '@/lib/format';
import { distanceKm } from '@/lib/geo';
import type { SolicitudBroadcastPayload } from '@/shared/realtime';
import type { Ambulancia, Ubicacion } from '@/types/domain';

/**
 * Citizen "ask for an ambulance" projection.
 *
 * Pure helpers for the citizen's own request flow: which units get the alert,
 * what the broadcast looks like, and how its copy/labels are derived. Nothing
 * here touches a store or the network — the store action and the rail render
 * from these values, so the rules are unit-testable in isolation.
 *
 * <p>Asking for an ambulance does NOT depend on an affected zone: the zone is a
 * map warning only. The request carries the citizen's pickup point, and the
 * alert reaches every available unit.
 */

/** Units alerted at once by a citizen request (mockup `C.c3`: "las 3"). */
export const CITIZEN_BROADCAST_LIMIT = 3;

/** Registry label for a request whose emergency has no description of its own. */
export const CITIZEN_REQUEST_LABEL = 'Solicitud de ambulancia';

/**
 * Honest reasons the citizen request cannot be sent. The store publishes one as
 * its `startError` and the screen renders it next to the button, so a blocked
 * request never looks dead. They are UI copy (Spanish), one per real cause.
 */
export const CITIZEN_REQUEST_REASONS = {
  noLocation:
    'No pudimos obtener tu ubicación. Activa el GPS del dispositivo o marca el punto de recogida en el mapa.',
  noUnits: 'No hay ambulancias disponibles en este momento.',
  failed: 'No se pudo enviar la solicitud. Intenta de nuevo.',
} as const;

/**
 * True for a canonical RFC 4122 UUID (any version). The backend request id is a
 * `java.util.UUID`, so anything else (`REQ-…`) is rejected before the accept.
 * Used as the last guard before an accept/reject is sent.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Coordinates as the citizen subtitle writes them; no reverse geocoding. */
export function formatCoordinates(position: Ubicacion): string {
  return `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`;
}

export interface CitizenSceneLabelOptions {
  /**
   * True when `position` is the demo fallback (Suba) rather than the device's
   * real fix, e.g. the GPS was denied or is still unavailable. The label must
   * never claim a fallback is the citizen's actual location.
   */
  fallback?: boolean;
}

/**
 * The citizen scene label. There is no reverse geocoding, so the screen shows
 * the position instead of inventing a street address. A fallback position is
 * labelled as a reference/demo point, never as "tu ubicación actual".
 */
export function citizenSceneLabel(
  position: Ubicacion,
  options: CitizenSceneLabelOptions = {},
): string {
  const coordinates = formatCoordinates(position);
  return options.fallback
    ? `Ubicación de referencia (demo) · ${coordinates}`
    : `Tu ubicación actual · ${coordinates}`;
}

/** Total units currently AVAILABLE; drives the "no impossible search" gate. */
export function countAvailableUnits(units: Ambulancia[]): number {
  return units.filter((unit) => unit.estado === 'AVAILABLE').length;
}

/** Every currently AVAILABLE unit: the dispatch broadcasts to all of them. */
export function availableUnits(units: Ambulancia[]): Ambulancia[] {
  return units.filter((unit) => unit.estado === 'AVAILABLE');
}

/** Available units nearest to the citizen, nearest first, capped at `limit`. */
export function nearestAvailableUnits(
  units: Ambulancia[],
  origin: Ubicacion,
  limit = CITIZEN_BROADCAST_LIMIT,
): Ambulancia[] {
  return availableUnits(units)
    .map((unit) => ({ unit, km: distanceKm(origin, unit.ubicacion) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
    .map((entry) => entry.unit);
}

/**
 * Search intro copy, adjusted to how many units were really alerted (L5): the
 * screen never promises three when fewer were notified.
 */
export function searchIntroText(notifiedCount: number): string {
  if (notifiedCount === 1) {
    return 'Avisamos a la ambulancia disponible más cercana. La primera que acepte va hacia ti.';
  }
  return `Avisamos al mismo tiempo a las ${notifiedCount} ambulancias disponibles. La primera que acepte va hacia ti.`;
}

/**
 * Elapsed search time as `m:ss`, the mockup's "Buscando hace 0:08". It reuses
 * the app's `formatCountdown` by shifting the target forward by the elapsed
 * amount, so both the countdown and the elapsed counter share one convention.
 */
export function searchElapsed(startedAtMs: number, now: Date): string {
  const elapsedMs = Math.max(0, now.getTime() - startedAtMs);
  return formatCountdown(new Date(now.getTime() + elapsedMs).toISOString(), now);
}

/** "A-09 y A-15" / "A-09, A-12 y A-15" — Spanish list for the footer note. */
export function formatUnitList(ids: string[]): string {
  if (ids.length <= 1) {
    return ids[0] ?? '';
  }
  return `${ids.slice(0, -1).join(', ')} y ${ids[ids.length - 1]}`;
}

export interface CitizenBroadcastInput {
  requestId: string;
  origin: Ubicacion;
  units: Ambulancia[];
  now?: number;
}

/**
 * Builds the citizen's broadcast. `escena` is the real pickup point and
 * `notificadas` holds EVERY available unit — the same no-zone-filter broadcast
 * the backend performs. It is the DEMO path; against a backend the server owns
 * the broadcast.
 *
 * A citizen request has no pre-existing emergency and no triage behind it, so
 * the request stands for itself: its id doubles as the emergency id, it carries
 * no declared `nivel` (the driver card shows "Sin clasificar" instead of an
 * invented severity) and `zonaId` is left empty because the citizen declared no
 * zone — the coordinates already travel in `escena`. Returns `null` with zero
 * available units so the button never starts an impossible search.
 */
export function buildCitizenBroadcast(
  input: CitizenBroadcastInput,
): SolicitudBroadcastPayload | null {
  const notified = availableUnits(input.units);
  if (notified.length === 0) {
    return null;
  }
  const now = input.now ?? Date.now();
  return {
    type: 'solicitud.broadcast',
    requestId: input.requestId,
    emergenciaId: input.requestId,
    // No declared zone: the citizen only reports a position, which `escena`
    // already carries. Filling this with coordinates was the bug (C2).
    zonaId: '',
    tipo: CITIZEN_REQUEST_LABEL,
    escena: input.origin,
    timeoutEn: new Date(now + SOLICITUD_TIMEOUT_MS).toISOString(),
    notificadas: notified.map((unit) => unit.id),
    notifiedCount: notified.length,
    mode: 'broadcast',
    timeoutMs: SOLICITUD_TIMEOUT_MS,
  };
}
