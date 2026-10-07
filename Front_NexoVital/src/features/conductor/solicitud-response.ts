import type { SolicitudAmbulancia } from '@/types/domain';

/**
 * Server rule for answering a request, mirrored by the driver UI.
 *
 * The backend accepts `POST /solicitudes/{id}/accept|reject` for a request that
 * is still `PENDIENTE` and whose `ambulanciasNotificadas` contains the unit
 * (`SolicitudAmbulancia.fueNotificada`), unless that unit already declined it:
 * a decline is final for the unit that made it (EP-04.F2.US5). The front was
 * STRICTER than that: it only allowed the inbox's single open broadcast, hiding
 * every older pending request the unit was also notified about.
 *
 * This rule is deliberately INDEPENDENT of delivery order: a notified pending
 * request is respondible whether it arrived first or last. It is NOT the arbiter
 * — the server still decides the winner with its atomic CAS; `unitId` must be
 * the resolved id of the authenticated driver's own unit, so an unresolved unit
 * (empty string) can never offer an action the server would refuse.
 */
export function canRespondToSolicitud(solicitud: SolicitudAmbulancia, unitId: string): boolean {
  return (
    solicitud.estado === 'PENDING' &&
    unitId.length > 0 &&
    solicitud.ambulanciasNotificadas.includes(unitId) &&
    !rejectedByUnit(solicitud, unitId)
  );
}

/** Said on a request this unit declined: it is still open, but not for this unit. */
export const REJECTED_BY_UNIT_REASON =
  'Ya rechazaste esta solicitud. Sigue disponible para las demás ambulancias.';

/** Label of a registry row this unit declined. */
export const REJECTED_BY_UNIT_LABEL = 'Rechazada por ti';

/**
 * Whether this unit declined the request (EP-04.F2.US5). The server records the
 * decline and refuses that unit's accept afterwards (409
 * `SOLICITUD_YA_RECHAZADA`), so the row stays visible while the request is open
 * but is no longer answerable. An unresolved unit (empty string) declined
 * nothing.
 */
export function rejectedByUnit(solicitud: SolicitudAmbulancia, unitId: string): boolean {
  return unitId.length > 0 && (solicitud.ambulanciasRechazaron ?? []).includes(unitId);
}

/**
 * Honest, per-row reason why the action buttons stay disabled; `null` when the
 * row is respondible. It never invents a state: it reads the registry row's own
 * `estado` and notified list, the same two facts the server checks.
 *
 * The "own unit unresolved" case is handled by the caller (it owns the session),
 * which is why this helper only reasons about a resolved, non-empty `unitId`.
 */
export function solicitudResponseBlockReason(
  solicitud: SolicitudAmbulancia,
  unitId: string,
): string | null {
  if (solicitud.estado !== 'PENDING') {
    return 'Esta solicitud ya no está pendiente: el servidor no la aceptaría.';
  }
  if (unitId.length === 0 || !solicitud.ambulanciasNotificadas.includes(unitId)) {
    return 'No fuiste avisado de esta solicitud: el servidor no la aceptaría.';
  }
  if (rejectedByUnit(solicitud, unitId)) {
    return REJECTED_BY_UNIT_REASON;
  }
  return null;
}
