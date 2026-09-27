import { useEffect } from 'react';
import { create } from 'zustand';
import { solicitarAmbulancia } from '@/features/solicitudes/solicitud-api';
import {
  CITIZEN_CENTRO_AYUDA_ID,
  nextRequestId,
  toSolicitud,
} from '@/features/solicitudes/solicitud-form';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { isDemoMode } from '@/services/apiClient';
import {
  DESTINATIONS,
  type RealtimePort,
  type SolicitudCancelPayload,
  type SolicitudConfirmarPayload,
  type SolicitudPayload,
} from '@/shared/realtime';
import type { Ambulancia, Ubicacion } from '@/types/domain';
import { buildCitizenBroadcast } from './citizen-request';

/**
 * The citizen's own request lifecycle. `accepted` -> `arrived` -> `closed` is
 * driven ONLY by the relay's events (`request.taken`, `request.arrived`,
 * `request.confirmed`); the citizen's confirm publishes and waits.
 */
export type CitizenRequestPhase = 'idle' | 'searching' | 'accepted' | 'arrived' | 'closed';

interface CitizenRequestState {
  phase: CitizenRequestPhase;
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
   * the request through `POST /api/v1/solicitudes` and adopts the server's
   * response (id, estado, timestamps, notified units). Returns `false` (and
   * changes nothing) when no unit is available, so the button cannot start a
   * search that can never be answered.
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
  /** Drops the search state without publishing (e.g. after an accept). */
  reset: () => void;
}

interface CitizenRequestStart {
  port: RealtimePort | null;
  units: Ambulancia[];
  origin: Ubicacion;
  now?: number;
}

const IDLE_STATE = {
  phase: 'idle' as CitizenRequestPhase,
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

  start: async ({ port, units, origin, now }) => {
    const startedAt = now ?? Date.now();
    const requestId = nextRequestId();
    const payload = buildCitizenBroadcast({ requestId, origin, units, now: startedAt });
    if (!payload) {
      return false;
    }

    // Demo build: no backend exists, so the request is published on the relay
    // and the local projection is the source of truth (unchanged behaviour).
    if (isDemoMode()) {
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
      });
      return true;
    }

    // Real backend: the server creates the request and OWNS its identity and
    // state, so the store adopts the response instead of the local projection.
    // `emergenciaId`/`zonaId` are the front's documented placeholders: the
    // citizen request carries no emergency and declares no zone (see CR-G).
    try {
      const solicitud = await solicitarAmbulancia({
        emergenciaId: payload.emergenciaId,
        centroAyudaId: CITIZEN_CENTRO_AYUDA_ID,
        zonaId: payload.zonaId,
        timeoutEn: payload.timeoutEn,
      });
      useSolicitudesStore.getState().upsert({ ...solicitud, tipo: payload.tipo });
      set({
        phase: 'searching',
        requestId: solicitud.id,
        startedAt: Date.parse(solicitud.solicitadaEn),
        notifiedIds: solicitud.ambulanciasNotificadas,
        acceptedBy: null,
        acceptedAt: null,
        arrivedAt: null,
        confirmedAt: null,
      });
      return true;
    } catch {
      // The server never created the request: never leave a phantom search.
      set({ ...IDLE_STATE });
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
    // Publish only: the request closes when the relay echoes `request.confirmed`,
    // so the client never decides the outcome on its own.
    port?.publish<SolicitudConfirmarPayload>(DESTINATIONS.solicitudes, {
      type: 'solicitud.confirmar',
      requestId,
    });
  },

  endOnConfirmed: (requestId) => {
    const state = get();
    // Idempotent: the confirmation closes an already-arrived request exactly
    // once; a repeat must not reopen it or reset the closing instant.
    if (state.requestId !== requestId || state.phase !== 'arrived') {
      return;
    }
    set({ phase: 'closed', confirmedAt: Date.now() });
  },

  reset: () => set({ ...IDLE_STATE }),
}));

/**
 * Feeds the store from the request topic: only the arbiter's events for OUR
 * request id end the search or advance it. Broadcasts from other clients are
 * ignored.
 */
export function useCitizenRequestSync(port: RealtimePort | null): void {
  useEffect(() => {
    if (!port) {
      return;
    }
    return port.subscribe<SolicitudPayload>(DESTINATIONS.solicitudes, (payload) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }
      if (payload.type === 'request.taken') {
        useCitizenRequestStore.getState().endOnTaken(payload.requestId, payload.winner);
        return;
      }
      if (payload.type === 'request.arrived') {
        useCitizenRequestStore.getState().applyArrived(payload.requestId);
        return;
      }
      if (payload.type === 'request.confirmed') {
        useCitizenRequestStore.getState().endOnConfirmed(payload.requestId);
      }
    });
  }, [port]);
}
