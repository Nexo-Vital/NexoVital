import { activeEmergencies, SOLICITUD_TIMEOUT_MS } from '@/features/solicitudes/solicitud-form';
import { formatCountdown } from '@/lib/format';
import { distanceKm } from '@/lib/geo';
import type { SolicitudBroadcastPayload } from '@/shared/realtime';
import type { Ambulancia, CentroAyuda, Emergencia, Ubicacion } from '@/types/domain';

/**
 * Citizen "ask for an ambulance" projection.
 *
 * Pure helpers for the citizen's own request flow: which units get the alert,
 * what the broadcast looks like, and how its copy/labels are derived. Nothing
 * here touches a store or the network — the store action and the rail render
 * from these values, so the rules are unit-testable in isolation.
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
  noEmergency:
    'No hay una emergencia activa reportada. Reporta primero la zona afectada y vuelve a pedir la ambulancia.',
  noCenter: 'El mapa todavía no tiene centros de ayuda a los que dirigir la solicitud.',
  noZone:
    'La emergencia no tiene zona y ningún centro cercano declara una. No se puede enviar la solicitud.',
  noUnits: 'No hay ambulancias disponibles en este momento.',
  failed: 'No se pudo enviar la solicitud. Intenta de nuevo.',
} as const;

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

/** Available units nearest to the citizen, nearest first, capped at `limit`. */
export function nearestAvailableUnits(
  units: Ambulancia[],
  origin: Ubicacion,
  limit = CITIZEN_BROADCAST_LIMIT,
): Ambulancia[] {
  return units
    .filter((unit) => unit.estado === 'AVAILABLE')
    .map((unit) => ({ unit, km: distanceKm(origin, unit.ubicacion) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
    .map((entry) => entry.unit);
}

/**
 * The citizen's most recently created ACTIVE emergency, or null when there is
 * none. The request is anchored to THIS emergency: a local `REQ-…` id is not an
 * emergency and the backend rejects it as an invalid `UUID`. Ties keep the list
 * order, so the caller's ordering stays authoritative.
 */
export function latestActiveEmergency(emergencies: Emergencia[]): Emergencia | null {
  return activeEmergencies(emergencies).reduce<Emergencia | null>(
    (latest, item) =>
      latest === null || Date.parse(item.createdAt) >= Date.parse(latest.createdAt) ? item : latest,
    null,
  );
}

/**
 * The aid center nearest to `origin`, or null when the map holds none. The
 * request points the backend at a REAL center by id, so picking the nearest is
 * the natural destination; against the seeded backend every center is in Suba,
 * which is where the citizen fallback origin sits too. Returns null on an empty
 * list so the caller can fail honestly instead of sending a blank center.
 */
export function nearestCentro(centros: CentroAyuda[], origin: Ubicacion): CentroAyuda | null {
  return (
    centros
      .map((centro) => ({ centro, km: distanceKm(origin, centro.ubicacion) }))
      .sort((a, b) => a.km - b.km)[0]?.centro ?? null
  );
}

/**
 * Search intro copy, adjusted to how many units were really alerted (L5): the
 * screen never promises three when fewer were notified.
 */
export function searchIntroText(notifiedCount: number): string {
  if (notifiedCount === 1) {
    return 'Avisamos a la ambulancia disponible más cercana. La primera que acepte va hacia ti.';
  }
  return `Avisamos al mismo tiempo a las ${notifiedCount} ambulancias disponibles más cercanas. La primera que acepte va hacia ti.`;
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
 * Builds the citizen's broadcast. `escena` is the real citizen position and
 * `notificadas` the nearest available units.
 *
 * A citizen request has no pre-existing emergency and no triage behind it, so
 * the request stands for itself: its id doubles as the emergency id, it carries
 * no declared `nivel` (the driver card shows "Sin clasificar" instead of an
 * invented severity) and `zonaId` is left empty because the citizen declared no
 * zone — the coordinates already travel in `escena`. A request created from the
 * CRUE keeps its emergency's real `nivel` and `zonaId`. Returns `null` with zero
 * available units so the button never starts an impossible search.
 */
export function buildCitizenBroadcast(
  input: CitizenBroadcastInput,
): SolicitudBroadcastPayload | null {
  const notified = nearestAvailableUnits(input.units, input.origin);
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
