import {
  DESTINATIONS,
  type RealtimeEnvelope,
  type RequestAlreadyTakenPayload,
  type RequestCancelledPayload,
  type RequestRejectedPayload,
  type RequestTakenPayload,
  type SolicitudMode,
  type SolicitudPayload,
} from './messages';

/**
 * Pure fake arbiter for the request rules, used by the dev WebSocket relay.
 * Kept transport-free so it is unit-testable and so the real backend can
 * replace it later without touching client code.
 *
 * Contract:
 *   - `solicitud.broadcast` re-opens a request id (a new broadcast round).
 *     The FIRST `solicitud.accept` for an open request wins; the relay emits
 *     `request.taken { winner }`. Any later accept is rejected with
 *     `request.already-taken { winner }`.
 *   - `solicitud.direct` targets exactly one unit. Only that unit can accept;
 *     an accept from anyone else is rejected with `request.rejected`.
 *   - A broadcast is only visible to the units in `notificadas` (an L3
 *     client-side filter). The arbiter enforces the same invariant server-side:
 *     an accept from a unit that was NOT notified is rejected with
 *     `request.rejected { reason: 'not-notified' }`, so a client that publishes
 *     an accept directly — or a stale build without the filter — cannot win a
 *     request that was never offered to it.
 *   - A `solicitud.reject` from the direct target re-opens the request so it
 *     can be re-sent. Broadcast behaviour is unchanged: rejects pass through.
 *   - `solicitud.cancel` withdraws the request: the pending metadata and any
 *     winner are dropped, and `request.cancelled` is fanned out so every client
 *     stops offering a mission nobody asked for.
 */
export interface ArbiterRequest {
  mode: SolicitudMode;
  targetAmbulanceId?: string;
  open: boolean;
  /**
   * Units this request was delivered to. Direct mode always targets one unit;
   * broadcast mode copies the payload's `notificadas`. It is `undefined` when a
   * legacy broadcast frame carries no list, in which case enforcement is
   * skipped rather than rejecting every unit.
   */
  notificadas?: string[];
}

/** requestId -> request metadata. Persistent for the life of the relay. */
export type ArbiterRequests = Map<string, ArbiterRequest>;

export function resolveArbiterMessages(
  raw: string,
  winners: Map<string, string>,
  requests: ArbiterRequests = new Map(),
): string[] {
  const envelope = parseEnvelope(raw);
  if (!envelope || envelope.destination !== DESTINATIONS.solicitudes) {
    return [raw];
  }

  const payload = envelope.payload;

  if (
    (payload.type === 'solicitud.broadcast' || payload.type === 'solicitud.direct') &&
    typeof payload.requestId === 'string'
  ) {
    // A fresh request of either mode re-opens the id for the next demo round.
    winners.delete(payload.requestId);
    if (payload.type === 'solicitud.direct' && typeof payload.targetAmbulanceId === 'string') {
      requests.set(payload.requestId, {
        mode: 'direct',
        targetAmbulanceId: payload.targetAmbulanceId,
        open: true,
        notificadas: [payload.targetAmbulanceId],
      });
    } else {
      requests.set(payload.requestId, {
        mode: 'broadcast',
        open: true,
        // A broadcast frames its recipients in `notificadas`; keep the snapshot
        // the arbiter will enforce so a later accept is checked against the
        // exact set that was notified for THIS round.
        notificadas: Array.isArray(payload.notificadas) ? [...payload.notificadas] : undefined,
      });
    }
    return [raw];
  }

  if (payload.type === 'solicitud.reject') {
    const { requestId, ambulanceId } = payload;
    if (typeof requestId === 'string' && typeof ambulanceId === 'string') {
      const request = requests.get(requestId);
      if (request?.mode === 'direct' && request.targetAmbulanceId === ambulanceId) {
        // The target declined: reopen the request so the center can re-send it.
        winners.delete(requestId);
        request.open = true;
      }
    }
    return [raw];
  }

  if (payload.type === 'solicitud.cancel') {
    const { requestId } = payload;
    if (typeof requestId !== 'string') {
      return [raw];
    }
    // Withdraw the request: drop any winner and the pending metadata, then tell
    // every client to remove it. A later broadcast of the same id re-opens it.
    winners.delete(requestId);
    requests.delete(requestId);
    return [
      serialize(DESTINATIONS.solicitudes, {
        type: 'request.cancelled',
        requestId,
      } satisfies RequestCancelledPayload),
    ];
  }

  if (payload.type === 'solicitud.accept') {
    const { requestId, ambulanceId } = payload;
    if (typeof requestId !== 'string' || typeof ambulanceId !== 'string') {
      return [raw];
    }

    const request = requests.get(requestId);
    if (request?.mode === 'direct' && ambulanceId !== request.targetAmbulanceId) {
      // Only the addressed unit may accept a direct request.
      return [
        serialize(DESTINATIONS.solicitudes, {
          type: 'request.rejected',
          requestId,
          rejected: ambulanceId,
          reason: 'not-targeted',
        } satisfies RequestRejectedPayload),
      ];
    }

    if (
      request?.mode === 'broadcast' &&
      Array.isArray(request.notificadas) &&
      !request.notificadas.includes(ambulanceId)
    ) {
      // L3 parity: the broadcast's inbox filter lives in the client, so without
      // this check a client that publishes the accept directly (or a stale
      // build) could win a request it was never notified about. The arbiter
      // owns the invariant on both transports (Vite dev relay and the Worker
      // `RealtimeRoom`, which share this function).
      return [
        serialize(DESTINATIONS.solicitudes, {
          type: 'request.rejected',
          requestId,
          rejected: ambulanceId,
          reason: 'not-notified',
        } satisfies RequestRejectedPayload),
      ];
    }

    const winner = winners.get(requestId);
    if (winner) {
      return [
        serialize(DESTINATIONS.solicitudes, {
          type: 'request.already-taken',
          requestId,
          winner,
          rejected: ambulanceId,
        } satisfies RequestAlreadyTakenPayload),
      ];
    }
    winners.set(requestId, ambulanceId);
    if (request) {
      request.open = false;
    }
    return [
      serialize(DESTINATIONS.solicitudes, {
        type: 'request.taken',
        requestId,
        winner: ambulanceId,
      } satisfies RequestTakenPayload),
    ];
  }

  return [raw];
}

function parseEnvelope(raw: string): RealtimeEnvelope<SolicitudPayload> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const candidate = parsed as RealtimeEnvelope<SolicitudPayload>;
    if (typeof candidate.destination !== 'string') {
      return null;
    }
    if (typeof candidate.payload !== 'object' || candidate.payload === null) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

export function serialize(destination: string, payload: SolicitudPayload): string {
  return JSON.stringify({ destination, payload } satisfies RealtimeEnvelope<SolicitudPayload>);
}
