import {
  DESTINATIONS,
  type RealtimeEnvelope,
  type RequestAlreadyTakenPayload,
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
 *   - A `solicitud.reject` from the direct target re-opens the request so it
 *     can be re-sent. Broadcast behaviour is unchanged: rejects pass through.
 */
export interface ArbiterRequest {
  mode: SolicitudMode;
  targetAmbulanceId?: string;
  open: boolean;
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
      });
    } else {
      requests.set(payload.requestId, { mode: 'broadcast', open: true });
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
