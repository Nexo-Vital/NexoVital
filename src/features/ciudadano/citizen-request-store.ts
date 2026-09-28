import { useEffect } from 'react';
import { create } from 'zustand';
import { toast } from '@/components/ui/toast';
import { confirmarSolicitud, solicitarAmbulancia } from '@/features/solicitudes/solicitud-api';
import {
  nextRequestId,
  SOLICITUD_TIMEOUT_MS,
  toSolicitud,
} from '@/features/solicitudes/solicitud-form';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { isSessionInSync, SESSION_CHANGED_MESSAGE } from '@/features/usuarios/session-sync';
import { isDemoMode } from '@/services/apiClient';
import {
  DESTINATIONS,
  fromWireSolicitud,
  type RealtimePort,
  type SolicitudCancelPayload,
  type SolicitudConfirmarPayload,
  type SolicitudPayload,
  solicitudFrameFromWire,
} from '@/shared/realtime';
import type { Ambulancia, CentroAyuda, Emergencia, Ubicacion } from '@/types/domain';
import {
  buildCitizenBroadcast,
  CITIZEN_REQUEST_LABEL,
  CITIZEN_REQUEST_REASONS,
  isUuid,
  latestActiveEmergency,
  nearestCentro,
} from './citizen-request';

/**
 * The citizen's own request lifecycle. `accepted` -> `arrived` -> `closed` is
 * driven ONLY by the relay's events (`request.taken`, `request.arrived`,
 * `request.confirmed`); the citizen's confirm publishes and waits. `expired` is
 * the terminal backend `TIMEOUT`: the request was never taken and is no longer
 * active.
 */
export type CitizenRequestPhase =
  | 'idle'
  | 'searching'
  | 'accepted'
  | 'arrived'
  | 'closed'
  | 'expired';

interface CitizenRequestState {
  phase: CitizenRequestPhase;
  /**
   * Honest reason the last `start` could not open a search, or null. The screen
   * renders it so a blocked request never looks dead; it is cleared on a new
   * attempt, on success, and on reset/cancel.
   */
  startError: string | null;
  requestId: string | null;
  /** When the search began (epoch ms); drives the elapsed counter. */
  startedAt: number | null;
  /** Ids of the units the broadcast alerted. */
  notifiedIds: string[];
  /** Winner unit once a driver accepted; never chosen by this client. */
  acceptedBy: string | null;
  /** When the arbiter assigned our request (epoch ms); drives "hace N s". */
  acceptedAt: number | null;
  /** When the driver declared arrival (epoch ms); null until then. */
  arrivedAt: number | null;
  /** When the citizen confirmed (epoch ms); null until then. */
  confirmedAt: number | null;
  /**
   * Starts the search. In demo mode it publishes the broadcast on the relay and
   * the local projection is the source of truth; against a backend it creates
   * the request through `POST /api/v1/solicitudes` anchored to REAL data — the
   * newest active emergency, its zone and the nearest aid center — and adopts
   * the server's response (id, estado, timestamps, notified units). Returns
   * `false` (and changes nothing) when no unit is available in demo mode or, in
   * backend mode, when there is no active emergency, no reachable center or no
   * usable zone: `startError` then carries the honest reason for the screen.
   */
  start: (input: CitizenRequestStart) => Promise<boolean>;
  /** Withdraws the open request on the relay and clears the local state. */
  cancel: (port: RealtimePort | null) => void;
  /** Applies the server-side arbiter decision when OUR request was taken. */
  endOnTaken: (requestId: string, winner: string) => void;
  /** Applies the driver's declared arrival; idempotent. */
  applyArrived: (requestId: string) => void;
  /** Publishes the citizen's confirmation; the relay echoes `request.confirmed`. */
  confirmArrival: (port: RealtimePort | null) => void;
  /** Applies the relay's confirmation; idempotent, closes the request. */
  endOnConfirmed: (requestId: string) => void;
  /** Applies the backend `TIMEOUT`; the request expired and is no longer active. */
  endOnExpired: (requestId: string) => void;
  /** Applies the backend `TOMADA` close when the citizen did not confirm it. */
  endOnClosed: (requestId: string) => void;
  /**
   * Flags that the persisted session no longer matches this screen (another tab
   * signed in). Surfaces the honest reason in the rail; no request is sent.
   */
  flagSessionDesync: () => void;
  /** Drops the search state without publishing (e.g. after an accept). */
  reset: () => void;
}

interface CitizenRequestStart {
  port: RealtimePort | null;
  units: Ambulancia[];
  origin: Ubicacion;
  now?: number;
  /**
   * The citizen's emergencies (the emergency store snapshot). Against a backend
   * the request is anchored to the newest ACTIVE one, never to a local id.
   */
  emergencies?: Emergencia[];
  /** Aid centers from the map; the request points at the nearest REAL one. */
  centros?: CentroAyuda[];
}

const IDLE_STATE = {
  phase: 'idle' as CitizenRequestPhase,
  startError: null,
  requestId: null,
  startedAt: null,
  notifiedIds: [] as string[],
  acceptedBy: null,
  acceptedAt: null,
  arrivedAt: null,
  confirmedAt: null,
};

/**
 * Citizen request source of truth. The client only PUBLISHES the alert and the
 * withdrawal; who wins is decided by the relay/arbiter (rule C2), so this store
 * reacts to `request.taken` and never picks a winner itself.
 */
export const useCitizenRequestStore = create<CitizenRequestState>((set, get) => ({
  ...IDLE_STATE,

  start: async ({ port, units, origin, now, emergencies = [], centros = [] }) => {
    const startedAt = now ?? Date.now();

    // Demo build: no backend exists, so the request is published on the relay
    // and the local projection is the source of truth (unchanged behaviour).
    if (isDemoMode()) {
      const requestId = nextRequestId();
      const payload = buildCitizenBroadcast({ requestId, origin, units, now: startedAt });
      if (!payload) {
        set({ ...IDLE_STATE, startError: CITIZEN_REQUEST_REASONS.noUnits });
        return false;
      }
      useSolicitudesStore.getState().upsert(toSolicitud(payload, startedAt));
      port?.publish(DESTINATIONS.solicitudes, payload);
      set({
        phase: 'searching',
        requestId,
        startedAt,
        notifiedIds: payload.notificadas,
        acceptedBy: null,
        acceptedAt: null,
        arrivedAt: null,
        confirmedAt: null,
        startError: null,
      });
      return true;
    }

    // Real backend: the server creates the request and OWNS its identity and
    // state, so the store adopts the response instead of the local projection.
    // The body is anchored to REAL data — a local `REQ-…` id, a `CA-CRUE`
    // placeholder and a blank zone are all rejected by the backend (400) — so
    // the request is only sent when there is something real to point at.
    //
    // Presence is NOT enough: both ids must actually be UUIDs, because that is
    // what the backend's `java.util.UUID` fields parse. A leftover fixture id
    // (`EMG-002`, `CA-LA-GAITANA`) passes a bare truthiness check and is what
    // produced a raw 400; this guard is the defense in depth that never sends it.
    //
    // Before anything is sent, the persisted session must still belong to this
    // screen. Another tab can replace `nexovital.token` while this citizen screen
    // stays mounted; `apiFetch` would then authenticate with a FOREIGN token and
    // the backend would answer a misleading 403 permission error. Block it and
    // state the real reason: the session changed.
    if (!isSessionInSync()) {
      set({ ...IDLE_STATE, startError: SESSION_CHANGED_MESSAGE });
      return false;
    }
    const emergency = latestActiveEmergency(emergencies);
    if (!emergency) {
      set({ ...IDLE_STATE, startError: CITIZEN_REQUEST_REASONS.noEmergency });
      return false;
    }
    const centro = nearestCentro(centros, origin);
    if (!centro) {
      set({ ...IDLE_STATE, startError: CITIZEN_REQUEST_REASONS.noCenter });
      return false;
    }
    // Never POST an id the backend cannot deserialize as a UUID.
    if (!isUuid(emergency.id) || !isUuid(centro.id)) {
      set({ ...IDLE_STATE, startError: CITIZEN_REQUEST_REASONS.notServerData });
      return false;
    }
    // The backend resolves the zone when the emergency is reported; the chosen
    // center's zone is the honest fallback. With neither, do not send blind.
    const zonaId = emergency.zonaId.trim() || centro.zonaId?.trim() || '';
    if (zonaId === '') {
      set({ ...IDLE_STATE, startError: CITIZEN_REQUEST_REASONS.noZone });
      return false;
    }

    try {
      const solicitud = await solicitarAmbulancia({
        emergenciaId: emergency.id,
        centroAyudaId: centro.id,
        zonaId,
        timeoutEn: new Date(startedAt + SOLICITUD_TIMEOUT_MS).toISOString(),
      });
      useSolicitudesStore.getState().upsert({
        ...solicitud,
        tipo: emergency.descripcion?.trim() || CITIZEN_REQUEST_LABEL,
      });
      set({
        phase: 'searching',
        requestId: solicitud.id,
        startedAt: Date.parse(solicitud.solicitadaEn),
        notifiedIds: solicitud.ambulanciasNotificadas,
        acceptedBy: null,
        acceptedAt: null,
        arrivedAt: null,
        confirmedAt: null,
        startError: null,
      });
      return true;
    } catch (error) {
      // The server never created the request: never leave a phantom search, and
      // never fail silently. The backend's Spanish `mensaje` is surfaced as-is.
      const reason =
        error instanceof Error && error.message ? error.message : CITIZEN_REQUEST_REASONS.failed;
      set({ ...IDLE_STATE, startError: reason });
      return false;
    }
  },

  cancel: (port) => {
    const { requestId, phase } = get();
    if (requestId && phase !== 'idle') {
      port?.publish<SolicitudCancelPayload>(DESTINATIONS.solicitudes, {
        type: 'solicitud.cancel',
        requestId,
      });
    }
    set({ ...IDLE_STATE });
  },

  endOnTaken: (requestId, winner) => {
    const state = get();
    // Idempotent, first acceptance wins: a repeated `request.taken` for the
    // request we already accepted must not reset `acceptedAt` (the "hace N s"
    // counter would jump back to zero) nor change the winner (which would
    // reopen the notice). An acceptance for another request still never affects
    // us. The driver inbox keeps the same guard with `wonRequestIdRef`.
    if (state.requestId !== requestId || state.phase === 'accepted') {
      return;
    }
    set({ phase: 'accepted', acceptedBy: winner, acceptedAt: Date.now() });
  },

  applyArrived: (requestId) => {
    const state = get();
    // Idempotent: only OUR accepted request advances, and only once, so a
    // repeated arrival never resets `arrivedAt` (the c5 clock is a real instant).
    if (state.requestId !== requestId || state.phase !== 'accepted') {
      return;
    }
    set({ phase: 'arrived', arrivedAt: Date.now() });
  },

  confirmArrival: (port) => {
    const { requestId, phase } = get();
    if (!requestId || phase !== 'arrived') {
      return;
    }
    // Demo: publish only; the request closes when the relay echoes
    // `request.confirmed`, so the client never decides the outcome on its own.
    if (isDemoMode()) {
      port?.publish<SolicitudConfirmarPayload>(DESTINATIONS.solicitudes, {
        type: 'solicitud.confirmar',
        requestId,
      });
      return;
    }
    // Backend: confirmation is REST (there is no @MessageMapping inbound) and the
    // SERVER's response is adopted as the truth. A failure is never silent: the
    // backend's message is surfaced and the request stays open for a retry.
    void confirmarSolicitud(requestId)
      .then((solicitud) => {
        const state = get();
        if (state.requestId !== requestId) {
          return;
        }
        useSolicitudesStore.getState().upsert(solicitud);
        state.endOnConfirmed(requestId);
      })
      .catch((error: unknown) => {
        toast(
          error instanceof Error && error.message
            ? error.message
            : 'No fue posible confirmar la llegada.',
        );
      });
  },

  endOnConfirmed: (requestId) => {
    const state = get();
    // Idempotent: the confirmation closes OUR request exactly once; a repeat
    // must not reopen it or reset the closing instant. The relay closes only an
    // arrived request, but the backend has no arrival state: its CONFIRMADA
    // arrives while the citizen is still 'accepted', so both phases close.
    if (
      state.requestId !== requestId ||
      (state.phase !== 'arrived' && state.phase !== 'accepted')
    ) {
      return;
    }
    set({ phase: 'closed', confirmedAt: Date.now() });
  },

  endOnExpired: (requestId) => {
    const state = get();
    // Only OUR open search expires, and only once: the backend emits TIMEOUT
    // while the request is still PENDIENTE (no winner), so anything already
    // accepted/arrived/closed is untouched.
    if (state.requestId !== requestId || state.phase !== 'searching') {
      return;
    }
    set({ phase: 'expired' });
  },

  endOnClosed: (requestId) => {
    const state = get();
    // The backend `TOMADA` close. In the normal loop the citizen already closed
    // it via `request.confirmed` (endOnConfirmed), so this is a no-op then; it
    // covers the case where the driver finished without the citizen confirming
    // and the rail would otherwise stay in 'accepted'/'arrived'. `confirmedAt`
    // is never invented: the citizen did not confirm.
    if (
      state.requestId !== requestId ||
      (state.phase !== 'accepted' && state.phase !== 'arrived' && state.phase !== 'closed')
    ) {
      return;
    }
    set({ phase: 'closed' });
  },

  reset: () => set({ ...IDLE_STATE }),

  flagSessionDesync: () => set({ startError: SESSION_CHANGED_MESSAGE }),
}));

/**
 * Applies one actionable frame to the citizen store. The union's broadcast,
 * cancel, accept and reject frames are NOT actionable here: the citizen only
 * reacts to the lifecycle of THEIR OWN request (`request.taken`,
 * `request.arrived`, `request.confirmed`).
 */
function applyCitizenFrame(payload: SolicitudPayload): void {
  const store = useCitizenRequestStore.getState();
  if (payload.type === 'request.taken') {
    // A wire ASIGNADA with no winner carries nothing actionable.
    if (payload.winner !== '') {
      store.endOnTaken(payload.requestId, payload.winner);
    }
    return;
  }
  if (payload.type === 'request.arrived') {
    store.applyArrived(payload.requestId);
    return;
  }
  if (payload.type === 'request.confirmed') {
    store.endOnConfirmed(payload.requestId);
    return;
  }
  if (payload.type === 'request.expired') {
    // Backend TIMEOUT: the request expired with no winner and is no longer active.
    store.endOnExpired(payload.requestId);
    return;
  }
  if (payload.type === 'request.closed') {
    // Backend TOMADA: the attended service was finished.
    store.endOnClosed(payload.requestId);
  }
}

/**
 * Feeds the store from `/user/queue/solicitudes`: only the arbiter's events for
 * OUR request id end the search or advance it. Broadcasts from other clients
 * are ignored.
 *
 * Two shapes share the destination. The dev relay sends the union frames with a
 * `type`. The backend `flota` module sends its own shape (no `type`, lifecycle
 * in `estado`), so it is reconciled first through the shared `solicitud-wire`
 * mapping: `ASIGNADA` becomes an acceptance, `CONFIRMADA` a confirmation,
 * `TIMEOUT` an expiry and `TOMADA` a close; `PENDIENTE` becomes a broadcast this
 * sync deliberately ignores.
 */
export function useCitizenRequestSync(port: RealtimePort | null): void {
  useEffect(() => {
    if (!port) {
      return;
    }
    return port.subscribe<unknown>(DESTINATIONS.solicitudes, (raw) => {
      if (!raw || typeof raw !== 'object') {
        return;
      }
      const wire = fromWireSolicitud(raw);
      if (wire) {
        // The citizen has no own ambulance id: ASIGNADA always names the winner.
        const frame = solicitudFrameFromWire(wire, { ownAmbulanceId: '' });
        if (frame) {
          applyCitizenFrame(frame);
        }
        return;
      }
      applyCitizenFrame(raw as SolicitudPayload);
    });
  }, [port]);
}
