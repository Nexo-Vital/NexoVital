import { useEffect } from 'react';
import { create } from 'zustand';
import { toast } from '@/components/ui/toast';
import {
  cancelarSolicitud,
  confirmarSolicitud,
  listarMisSolicitudes,
  solicitarAmbulancia,
} from '@/features/solicitudes/solicitud-api';
import { nextRequestId, toSolicitud } from '@/features/solicitudes/solicitud-form';
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
import type { Ambulancia, SolicitudAmbulancia, Ubicacion } from '@/types/domain';
import {
  buildCitizenBroadcast,
  CITIZEN_REQUEST_LABEL,
  CITIZEN_REQUEST_REASONS,
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
  /**
   * Honest reason the last cancellation failed (backend `mensaje`), or null. The
   * citizen keeps seeing the REAL request state and this reason instead of a
   * fake "cancelled"; it is cleared on a new attempt, on a successful cancel and
   * on reset.
   */
  cancelError: string | null;
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
   * the request through `POST /api/v1/solicitudes` with the citizen's pickup
   * point and adopts the server's response (id, estado, timestamps, notified
   * units). Returns `false` (and changes nothing) when there is no pickup point
   * (neither a device fix nor a map-picked point) or, in demo mode, when no unit
   * is available: `startError` then carries the honest reason for the screen.
   */
  start: (input: CitizenRequestStart) => Promise<boolean>;
  /**
   * Withdraws the open request. In demo mode it publishes `solicitud.cancel` on
   * the relay and clears the local state. Against a backend it calls the real
   * `POST /solicitudes/{id}/cancelar`: the request is only cleared on the
   * server's `200`; a refusal (409 already assigned, 403 not the requester) keeps
   * the real state and surfaces the backend reason instead of faking a cancel.
   */
  cancel: (port: RealtimePort | null) => Promise<void>;
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
  /** Adopts the server's view of our active request (EP-04.F2.US9). */
  restoreFromServer: (items: SolicitudAmbulancia[]) => void;
  /** Drops the search state without publishing (e.g. after an accept). */
  reset: () => void;
}

interface CitizenRequestStart {
  port: RealtimePort | null;
  units: Ambulancia[];
  /**
   * Pickup point: the device's position, or the point the citizen marked on the
   * map when the browser denied geolocation. `null` when neither exists, which
   * is the honest "no pickup point yet" case the screen must report.
   */
  origin: Ubicacion | null;
  /** Readable address of the pickup point, when the geocoder found one. */
  direccion?: string | null;
  now?: number;
}

/** Order of the open phases; a server read never moves a request backwards. */
const PHASE_RANK: Record<CitizenRequestPhase, number> = {
  idle: 0,
  expired: 0,
  searching: 1,
  accepted: 2,
  arrived: 3,
  closed: 4,
};

/** Phase a server request maps to, or null when it is not active. */
function phaseFromServer(solicitud: SolicitudAmbulancia): CitizenRequestPhase | null {
  if (solicitud.estado === 'PENDING') {
    return 'searching';
  }
  if (solicitud.estado === 'ASSIGNED') {
    return solicitud.llegadaEn ? 'arrived' : 'accepted';
  }
  if (solicitud.estado === 'CONFIRMED') {
    return 'closed';
  }
  return null;
}

function instantOrNull(value: string | undefined): number | null {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

const IDLE_STATE = {
  phase: 'idle' as CitizenRequestPhase,
  startError: null,
  cancelError: null,
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

  start: async ({ port, units, origin, direccion, now }) => {
    const startedAt = now ?? Date.now();

    // No pickup point means no honest request: with the GPS denied and no point
    // marked on the map, the screen reports it instead of sending a fake origin.
    if (!origin) {
      set({ ...IDLE_STATE, startError: CITIZEN_REQUEST_REASONS.noLocation });
      return false;
    }

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
        cancelError: null,
      });
      return true;
    }

    // Real backend: the server creates the request and OWNS its identity and
    // state, so the store adopts the response instead of the local projection.
    // The body carries ONLY the pickup point; the emergency, the aid center and
    // the zone are optional context and are deliberately left out — a request no
    // longer depends on an affected zone, so there is nothing else to anchor.
    //
    // Before anything is sent, the persisted session must still belong to this
    // screen. The session now lives in per-tab `sessionStorage`, so another tab
    // can no longer replace `nexovital.token` while this citizen screen stays
    // mounted. This guard is kept as defence in depth: if this tab's persisted
    // copy ever drifts from memory, `apiFetch` would authenticate with a FOREIGN
    // token and the backend would answer a misleading 403 permission error.
    // Block it and state the real reason: the session changed.
    if (!isSessionInSync()) {
      set({ ...IDLE_STATE, startError: SESSION_CHANGED_MESSAGE });
      return false;
    }

    try {
      const solicitud = await solicitarAmbulancia({
        // No deadline travels: the server fixes the accept window (EP-04.F2.US6).
        ubicacion: origin,
        ...(direccion ? { direccion } : {}),
      });
      useSolicitudesStore.getState().upsert({
        ...solicitud,
        tipo: CITIZEN_REQUEST_LABEL,
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
        cancelError: null,
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

  cancel: async (port) => {
    const { requestId, phase } = get();
    if (!requestId || phase === 'idle') {
      set({ ...IDLE_STATE });
      return;
    }

    // Demo build: the relay owns the arbitration, so the withdrawal is published
    // on the relay and the local projection is the source of truth (unchanged).
    if (isDemoMode()) {
      port?.publish<SolicitudCancelPayload>(DESTINATIONS.solicitudes, {
        type: 'solicitud.cancel',
        requestId,
      });
      set({ ...IDLE_STATE });
      return;
    }

    // Real backend: cancellation is a REST command and the SERVER owns the
    // outcome. The request is only cleared on the server's 200; a refusal (409
    // already assigned, 403 not the requester) keeps the REAL state and surfaces
    // the backend reason, so the citizen never sees a cancellation that did not
    // happen.
    set({ cancelError: null });
    try {
      await cancelarSolicitud(requestId);
      set({ ...IDLE_STATE });
      toast('Solicitud cancelada.');
    } catch (error) {
      const reason =
        error instanceof Error && error.message
          ? error.message
          : 'No fue posible cancelar la solicitud.';
      set({ cancelError: reason });
      toast(reason, 'error');
    }
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

  restoreFromServer: (items) => {
    const state = get();
    const open = PHASE_RANK[state.phase] > 0 && state.phase !== 'closed';
    const own = items.find((item) => item.id === state.requestId);
    // Keeps a local open request the server no longer lists; its push decides.
    const chosen = own ?? (open ? undefined : items[0]);
    const phase = chosen ? phaseFromServer(chosen) : null;
    if (!chosen || !phase) {
      return;
    }
    const same = chosen.id === state.requestId;
    if (same && PHASE_RANK[phase] < PHASE_RANK[state.phase]) {
      return;
    }
    useSolicitudesStore.getState().upsert({ ...chosen, tipo: CITIZEN_REQUEST_LABEL });
    const winner = chosen.ambulanciaAsignadaId ?? null;
    set({
      phase,
      requestId: chosen.id,
      startedAt: instantOrNull(chosen.solicitadaEn) ?? state.startedAt ?? Date.now(),
      notifiedIds: chosen.ambulanciasNotificadas,
      acceptedBy: winner,
      acceptedAt: winner ? ((same ? state.acceptedAt : null) ?? Date.now()) : null,
      arrivedAt: instantOrNull(chosen.llegadaEn),
      confirmedAt: same ? state.confirmedAt : null,
    });
  },

  reset: () => set({ ...IDLE_STATE }),

  flagSessionDesync: () => set({ startError: SESSION_CHANGED_MESSAGE }),
}));

/** Rereads the citizen's active request from the server; a failed read changes nothing. */
export function syncCitizenRequest(): void {
  listarMisSolicitudes()
    .then((items) => useCitizenRequestStore.getState().restoreFromServer(items))
    .catch(() => {
      // Best effort: the realtime channel keeps driving the screen.
    });
}

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
    // The push carries no time: reread to show the arrival time the server recorded.
    if (!isDemoMode()) {
      syncCitizenRequest();
    }
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
    return;
  }
  if (payload.type === 'request.cancelled') {
    // Backend CANCELADA (or the relay echo of our own withdrawal): the request is
    // no longer active and the screen returns to the initial state. Only OUR
    // request reacts; another client's withdrawal never touches our screen. It is
    // idempotent with the REST success path.
    if (store.requestId === payload.requestId) {
      store.reset();
    }
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
