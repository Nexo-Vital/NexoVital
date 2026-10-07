import { useCallback, useEffect, useRef, useState } from 'react';
import { notify, toast } from '@/components/ui/toast';
import { isUuid } from '@/features/ciudadano/citizen-request';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { etaMinutes } from '@/lib/geo';
import { ApiError, isDemoMode } from '@/services/apiClient';
import {
  DESTINATIONS,
  fromWireSolicitud,
  type RealtimePort,
  type SolicitudAcceptPayload,
  type SolicitudBroadcastPayload,
  type SolicitudLlegadaPayload,
  type SolicitudPayload,
  type SolicitudRejectPayload,
  solicitudFrameFromWire,
} from '@/shared/realtime';
import type { EmergencyLevel, SolicitudAmbulancia, Ubicacion } from '@/types/domain';
import { playRequestDing } from './request-sound';
import {
  aceptarSolicitud,
  declararLlegada,
  finalizarSolicitud,
  rechazarSolicitud,
} from './solicitud-api';

export type SolicitudPhase = 'idle' | 'submitting' | 'assigned' | 'taken' | 'rejected' | 'timeout';

/**
 * Honest reason shown while the driver's own unit is not resolved yet. Off-demo
 * the unit comes from the server, so until that read lands there is no unit id
 * to send: accepting or rejecting then would 400 and silently drop the request.
 * The inbox refuses to act and the card shows this instead (FIX B).
 */
export const UNIT_UNRESOLVED_REASON =
  'Todavía no podemos identificar tu ambulancia. Espera un momento e inténtalo de nuevo.';

/**
 * Honest reason shown when the open request id is not a server UUID. Off demo a
 * request that did not come from the backend must never be answered: the REST
 * paths would carry an id the server does not know (`REQ-…`) and fail mid-demo.
 * Same defense-in-depth as the citizen `isUuid` guard before `POST /solicitudes`.
 */
export const UNKNOWN_REQUEST_REASON =
  'Esta solicitud no proviene del servidor. Espera a que llegue una solicitud real e inténtalo de nuevo.';

/**
 * What the driver reads when another unit took a request this one was offered.
 * The request leaves the screen at once; this notice is all that remains of it.
 */
export const TAKEN_BY_OTHER_MESSAGE = 'La solicitud ya fue aceptada por otra ambulancia.';

/** Heading of that notice. */
export const TAKEN_BY_OTHER_TITLE = 'Solicitud ya aceptada';

/**
 * Backend codes of an accept that lost the request to another unit: the lost
 * CAS itself, and the state check that already found the request assigned.
 */
const LOST_ACCEPT_CODES = ['CAS_PERDIDO', 'SOLICITUD_NO_ASIGNABLE'];

/**
 * The server refused the accept because this unit had already declined the
 * request (EP-04.F2.US5). It is NOT a lost accept: the request is still open for
 * the other units, so the row stays and only stops being answerable.
 */
function isAlreadyRejected(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 409 && error.codigo === 'SOLICITUD_YA_RECHAZADA'
  );
}

function isLostAccept(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.codigo !== undefined &&
    LOST_ACCEPT_CODES.includes(error.codigo)
  );
}

/**
 * Mission lifecycle after this unit won the request. The client never sets a
 * phase on its own: `arrived` follows the relay's `request.arrived` and
 * `confirmed` follows its `request.confirmed`.
 */
export type DriverMissionPhase = 'en_route' | 'arrived' | 'confirmed';

export interface Mission {
  requestId: string;
  zonaId: string;
  tipo: string;
  /** Absent when the request declared no severity (a citizen request). */
  nivel?: EmergencyLevel;
  /**
   * Requester scene, when known. Optional because the backend `flota` push
   * carries no coordinates: the inbox resolves them from the emergency store
   * and leaves the scene absent when it cannot, instead of inventing a point.
   */
  escena?: Ubicacion;
  etaMinutes: number;
  /** When the arbiter assigned this mission (epoch ms). */
  acceptedAt: number;
  /** When this unit declared arrival (epoch ms); null until it does. */
  arrivedAt: number | null;
  /** When the citizen confirmed (epoch ms); null until they do. */
  confirmedAt: number | null;
}

/**
 * Minimal request description `winMission` needs. `SolicitudBroadcastPayload`
 * satisfies it structurally, and a registry `SolicitudAmbulancia` row projects
 * onto it through its own `zonaId`/`tipo`/`ubicacion`, so a win on a row that
 * never was the inbox's broadcast opens the SAME mission.
 */
interface MissionSource {
  zonaId: string;
  tipo: string;
  nivel?: EmergencyLevel;
  escena?: Ubicacion;
}

/**
 * Honest outcome of answering a registry row that is NOT the inbox's open
 * broadcast (the inline detail's Aceptar/Rechazar). It reuses the inbox
 * `SolicitudPhase` vocabulary so the rail's inline detail renders the same
 * status UI; the message is the server's own answer, never a fabricated win.
 */
export interface SolicitudResponseOutcome {
  /** The registry row this outcome belongs to. */
  requestId: string;
  /** A response is either in flight (`submitting`) or terminal. */
  phase: 'submitting' | 'assigned' | 'taken' | 'rejected';
  message: string;
}

export interface SolicitudInboxState {
  /**
   * The surfaced offer, GATED by the connection: `null` while the driver is
   * disconnected, even though the transport keeps delivering and the internal
   * state keeps every frame. Reconnecting re-surfaces an offer that is still
   * within its accept window; the existing countdown owns expiry.
   */
  broadcast: SolicitudBroadcastPayload | null;
  /**
   * Ids of the requests that are WAITING behind the open offer, oldest first.
   * The card (and the pop-up that mirrors it) shows one request at a time, the
   * one that was raised first; the rest wait here and take its place, in order,
   * when it is answered, taken by another unit, cancelled or expired. Gated by
   * the connection exactly like `broadcast`.
   */
  queuedIds: string[];
  /** Absolute deadline (epoch ms) of the accept window. */
  deadlineMs: number | null;
  /** Total accept window (ms), used by the countdown chip. */
  windowMs: number;
  /**
   * When the request was raised (epoch ms). Derived from the payload's
   * `timeoutEn` minus its `timeoutMs`; falls back to the receipt instant when
   * the frame carries no window length, since the payload has no explicit
   * request timestamp.
   */
  requestedAtMs: number | null;
  phase: SolicitudPhase;
  /**
   * True while an accept is in flight against the backend (REST), so the card
   * can keep its "Enviando…" state. The demo path stays synchronous and never
   * sets it.
   */
  accepting: boolean;
  /** Human-readable Spanish outcome; announced through aria-live by the rail. */
  outcomeMessage: string | null;
  /**
   * Honest outcome of the last inline-detail response for a row that is NOT the
   * open broadcast, keyed by its request id. `null` until the driver answers one.
   */
  responseOutcome: SolicitudResponseOutcome | null;
  mission: Mission | null;
  /** Derived mission phase; `en_route` until the arrival event arrives. */
  missionPhase: DriverMissionPhase;
  accept: () => void;
  reject: () => void;
  /**
   * Answers a SPECIFIC registry row by its id through the same REST/realtime
   * transport `accept`/`reject` use, WITHOUT touching the inbox's open
   * broadcast slot. The server stays the source of truth: a win opens the
   * mission, a loss or a refusal is reported honestly in `responseOutcome`.
   */
  respondTo: (solicitud: SolicitudAmbulancia, action: 'accept' | 'reject') => void;
  /** Called by the request card when the countdown reaches zero. */
  notifyTimeout: () => void;
  /**
   * Surfaces a request the driver can still answer that did NOT come through
   * the push (EP-04.F2.US1, D6): one read from the server after a reload or a
   * reconnection. It opens the SAME card a live frame opens, with the server's
   * own deadline, so the countdown shows the time that is really left. A request
   * that is already the open offer or the current mission, or whose window is
   * over, is ignored.
   */
  offerPending: (solicitud: SolicitudAmbulancia) => void;
  /**
   * Reopens the mission of a request this unit already won (EP-04.F2.US1, D6):
   * after a reload the mission lives only on the server, so the console reads
   * it back from the unit's own services. It never overrides a mission that is
   * already open and raises no "assigned" notice: nothing new happened.
   */
  restoreMission: (solicitud: SolicitudAmbulancia) => void;
  /** Declares arrival: publishes `solicitud.llegada` and waits for the relay. */
  declareArrival: () => void;
  /**
   * Ends the mission and releases the unit. Demo clears locally; against the
   * backend it calls `POST /solicitudes/{id}/finalizar` and only clears on the
   * server's `200`. Resolves `true` when the mission ended (so the caller may
   * return the unit to available), `false` when the server refused.
   */
  finishService: () => Promise<boolean>;
  dismiss: () => void;
}

const DEFAULT_WINDOW_MS = 45_000;

/** A request this unit can still answer, with the two instants its card needs. */
interface Offer {
  payload: SolicitudBroadcastPayload;
  /** Absolute deadline (epoch ms) of the accept window. */
  deadlineMs: number;
  /** When the request was raised (epoch ms); the order of the queue. */
  requestedAtMs: number;
  /** Whether the frame declared its own deadline, or the default window was used. */
  declared: boolean;
}

/**
 * Reads the two instants of an offer. A frame that declares its deadline (a
 * request read back from the server, or one offered late) keeps it, and with
 * the window length gives the real instant it was raised. A creation frame
 * declares neither: the window starts now.
 */
function toOffer(payload: SolicitudBroadcastPayload): Offer {
  const deadline =
    typeof payload.timeoutEn === 'string' ? Date.parse(payload.timeoutEn) : Number.NaN;
  const declared = Number.isFinite(deadline);
  const now = Date.now();
  return {
    payload,
    deadlineMs: declared ? deadline : now + DEFAULT_WINDOW_MS,
    requestedAtMs:
      declared && typeof payload.timeoutMs === 'number' ? deadline - payload.timeoutMs : now,
    declared,
  };
}

/** Oldest request first; two raised at the same instant keep their arrival order. */
function byRequestedAt(a: Offer, b: Offer): number {
  return a.requestedAtMs - b.requestedAtMs;
}
/** Stable empty list, so a disconnected inbox does not re-render its readers. */
const NO_QUEUED: string[] = [];
const TERMINAL_DISMISS_MS = 2600;
const ASSIGNED_DISMISS_MS = 1600;

/**
 * Driver inbox for /user/queue/solicitudes.
 *
 * The accept is a BID (rule C2): this hook NEVER sets a winner itself. In demo
 * mode it publishes `solicitud.accept` on the relay and reacts to
 * `request.taken` (won or lost) and `request.already-taken`. Against the real
 * backend (no `VITE_DEMO_MODE`) the accept/reject are REST commands
 * (`POST /api/v1/solicitudes/{id}/accept|reject`), because the backend has no
 * `@MessageMapping` for them; the SERVER's response is adopted as the truth
 * (a win opens the mission, a 409 is shown as a lost/toasted outcome).
 *
 * ONE request is offered at a time, in the order they were raised (first in,
 * first out). A request that arrives while another one is on screen does not
 * replace it: it waits in a queue and takes the card when the one before it is
 * answered, taken by another unit, cancelled or expired. So the request the
 * driver is reading never changes under their hand, and a reload shows the same
 * one first. The only exception is a request that turns out to be OLDER than
 * the one on screen (the server offers the open requests in a burst when the
 * unit becomes available): it goes first, unless the driver already answered.
 *
 * `online` gates ONLY the SURFACED offer: while it is false the transport keeps
 * receiving (and the internal state keeps every frame), so reconnecting
 * re-surfaces an offer still within its accept window. The accepted mission is
 * never gated.
 */
export function useSolicitudInbox(
  port: RealtimePort | null,
  ambulanceId: string,
  currentPosition: Ubicacion | null,
  online = true,
): SolicitudInboxState {
  const [broadcast, setBroadcast] = useState<SolicitudBroadcastPayload | null>(null);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [windowMs, setWindowMs] = useState(DEFAULT_WINDOW_MS);
  const [requestedAtMs, setRequestedAtMs] = useState<number | null>(null);
  const [phase, setPhase] = useState<SolicitudPhase>('idle');
  const [accepting, setAccepting] = useState(false);
  const [outcomeMessage, setOutcomeMessage] = useState<string | null>(null);
  const [responseOutcome, setResponseOutcome] = useState<SolicitudResponseOutcome | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);
  const [queuedIds, setQueuedIds] = useState<string[]>([]);

  /** The open offer with its instants, so a newer or older arrival can be ordered. */
  const activeOfferRef = useRef<Offer | null>(null);
  /** Requests waiting behind the open offer, oldest first. */
  const queueRef = useRef<Offer[]>([]);
  const broadcastRef = useRef<SolicitudBroadcastPayload | null>(null);
  const phaseRef = useRef<SolicitudPhase>('idle');
  const missionRef = useRef<Mission | null>(null);
  const positionRef = useRef<Ubicacion | null>(currentPosition);
  /**
   * Guards the REST accept against a double submit: a second click while the
   * request is in flight would race two CAS bids and one would lose for nothing.
   */
  const acceptingRef = useRef(false);
  /**
   * Guards a selected-row REST accept against a double submit, exactly like
   * `acceptingRef` does for the broadcast: two CAS bids for one click only race
   * one of them for nothing.
   */
  const respondingRef = useRef(false);
  /**
   * Request id this unit has already won. The relay broadcasts
   * `request.already-taken` to every client, so without this guard the winner
   * would see their own "Assigned to you" overwritten by "Taken by <self>".
   */
  const wonRequestIdRef = useRef<string | null>(null);
  /**
   * Last request announced as taken by another unit. The loss can be learnt
   * twice (the server's push and the 409 of this unit's own accept), and the
   * driver must read the notice once.
   */
  const announcedTakenRef = useRef<string | null>(null);
  const onlineRef = useRef(online);
  positionRef.current = currentPosition;
  phaseRef.current = phase;
  missionRef.current = mission;
  onlineRef.current = online;

  /** Publishes the queue (kept in a ref for the frame handler) to the render. */
  const syncQueue = useCallback((next: Offer[]) => {
    queueRef.current = next;
    setQueuedIds(next.map((offer) => offer.payload.requestId));
  }, []);

  /** Puts an offer on the card. It announces nothing: the caller decides that. */
  const showOffer = useCallback((offer: Offer) => {
    activeOfferRef.current = offer;
    broadcastRef.current = offer.payload;
    wonRequestIdRef.current = null;
    setBroadcast(offer.payload);
    setDeadlineMs(offer.deadlineMs);
    setWindowMs(offer.declared ? Math.max(1000, offer.deadlineMs - Date.now()) : DEFAULT_WINDOW_MS);
    setRequestedAtMs(offer.requestedAtMs);
    setPhase('idle');
    setOutcomeMessage(null);
  }, []);

  /** Adds a waiting request in its place, oldest first. */
  const enqueue = useCallback(
    (offer: Offer) => {
      syncQueue([...queueRef.current, offer].sort(byRequestedAt));
    },
    [syncQueue],
  );

  /** A request that is no longer available stops waiting. */
  const dropQueued = useCallback(
    (requestId: string) => {
      if (queueRef.current.some((offer) => offer.payload.requestId === requestId)) {
        syncQueue(queueRef.current.filter((offer) => offer.payload.requestId !== requestId));
      }
    },
    [syncQueue],
  );

  /**
   * Frees the card and hands it to the next waiting request, if any. A request
   * whose window closed while it waited is skipped: it is never offered with no
   * time left. The next one opens silently; its arrival was already announced.
   */
  const releaseSlot = useCallback(() => {
    activeOfferRef.current = null;
    broadcastRef.current = null;
    setBroadcast(null);
    setDeadlineMs(null);
    setRequestedAtMs(null);
    acceptingRef.current = false;
    setAccepting(false);
    setPhase('idle');
    setOutcomeMessage(null);
    const now = Date.now();
    const [next, ...rest] = queueRef.current.filter((offer) => offer.deadlineMs > now);
    syncQueue(rest);
    if (next) {
      showOffer(next);
    }
  }, [showOffer, syncQueue]);

  const dismiss = releaseSlot;

  /**
   * The offer became this unit's mission. The card is cleared and nothing takes
   * its place: a unit in a mission answers no other request, so the ones that
   * were waiting are dropped. They are read again when the mission ends.
   */
  const clearActive = useCallback(() => {
    activeOfferRef.current = null;
    broadcastRef.current = null;
    setBroadcast(null);
    setRequestedAtMs(null);
    acceptingRef.current = false;
    setAccepting(false);
  }, []);

  /**
   * Another unit took the request: it leaves this driver's screen AT ONCE.
   *
   * Nothing lingers: the open card is cleared without a terminal phase, the
   * registry row is dropped and so is any inline outcome of that row. What
   * remains is one notice saying why it is gone. The server decided the winner;
   * this only stops offering a request that is no longer available.
   *
   * It is safe to call more than once for the same request (the push and the
   * 409 of the driver's own accept can both arrive): the second call finds
   * nothing to clear and announces nothing. A driver who is not receiving
   * requests is not told about one they were not looking at.
   */
  const lostToAnotherUnit = useCallback(
    (requestId: string) => {
      dropQueued(requestId);
      if (broadcastRef.current?.requestId === requestId) {
        releaseSlot();
      }
      useSolicitudesStore.getState().remove(requestId);
      setResponseOutcome((current) => (current?.requestId === requestId ? null : current));
      if (announcedTakenRef.current === requestId) {
        return;
      }
      announcedTakenRef.current = requestId;
      if (onlineRef.current) {
        // Prominent on purpose: the request vanished from the screen, and the
        // driver has to see why.
        notify(TAKEN_BY_OTHER_TITLE, TAKEN_BY_OTHER_MESSAGE);
      }
    },
    [dropQueued, releaseSlot],
  );

  /**
   * This unit declined the request (EP-04.F2.US5). The decline is final and the
   * server recorded it, so the request stops being OFFERED here: it leaves the
   * waiting queue, and the card if it was the open one. Its registry row stays,
   * marked as declined, because the request is still open for the other units
   * and the driver may keep looking at it.
   */
  const recordOwnRejection = useCallback(
    (requestId: string) => {
      if (ambulanceId) {
        useSolicitudesStore.getState().markRejected(requestId, ambulanceId);
      }
      dropQueued(requestId);
    },
    [ambulanceId, dropQueued],
  );

  /**
   * Opens the mission for a WIN. Shared by the realtime `request.taken` path
   * (demo) and the REST accept path (backend): the server decided the winner in
   * both cases, so the client only adopts it.
   */
  const winMission = useCallback(
    (requestId: string, source: MissionSource) => {
      wonRequestIdRef.current = requestId;
      // A unit in a mission answers no other request: nothing keeps waiting.
      syncQueue([]);
      const scene = source.escena;
      const from = positionRef.current ?? scene;
      setPhase('assigned');
      setOutcomeMessage('Te la asignaron');
      setMission({
        requestId,
        zonaId: source.zonaId,
        tipo: source.tipo,
        nivel: source.nivel,
        ...(scene ? { escena: scene } : {}),
        // No scene means no honest ETA: 0 rather than an invented figure.
        etaMinutes: from && scene ? etaMinutes(from, scene) : 0,
        acceptedAt: Date.now(),
        arrivedAt: null,
        confirmedAt: null,
      });
    },
    [syncQueue],
  );

  /**
   * The sound of a request that has just arrived, played once per request (not
   * when a waiting one takes the card). The visible notice is the pop-up the
   * console mounts over the map, which mirrors the open offer. `playRequestDing`
   * reports `false` while the browser still blocks the audio or the driver
   * silenced it, so the UI is the honest source of that state.
   */
  const announceArrival = useCallback(() => {
    playRequestDing();
  }, []);

  /** Shared frame handler for both the demo union frames and the wire frames. */
  const applyFrame = useCallback(
    (payload: SolicitudPayload, fromWire: boolean) => {
      if (payload.type === 'solicitud.broadcast' || payload.type === 'solicitud.direct') {
        // Direct mode is addressed to one unit: everyone else ignores the frame
        // entirely (no request card, no accept bid). Broadcast reaches every unit.
        if (payload.type === 'solicitud.direct') {
          if (payload.targetAmbulanceId !== ambulanceId) {
            return;
          }
        } else if (
          !fromWire &&
          (!Array.isArray(payload.notificadas) || !payload.notificadas.includes(ambulanceId))
        ) {
          // L3: a broadcast is only visible to the units it notified. Without
          // this filter any driver could answer a request that never reached
          // them, and "the notified units" would be a decoration. A backend
          // frame already targets this user (per-user delivery, D-F1), so the
          // filter is deliberately skipped for wire frames.
          return;
        }
        // Normalize to the broadcast shape; `mode`/`targetAmbulanceId` survive
        // so the request card can label the two delivery modes distinctly.
        const offer = toOffer({ ...payload, type: 'solicitud.broadcast' });
        const requestId = offer.payload.requestId;
        const current = activeOfferRef.current;
        const currentPhase = phaseRef.current;

        // The same request again (the push and a read from the server can both
        // deliver it). It is never restarted nor announced twice; a frame that
        // declares the real deadline only corrects the countdown.
        if (current?.payload.requestId === requestId && currentPhase !== 'assigned') {
          if (offer.declared && currentPhase === 'idle') {
            showOffer(offer);
          }
          return;
        }
        if (queueRef.current.some((queued) => queued.payload.requestId === requestId)) {
          if (offer.declared) {
            syncQueue(
              queueRef.current
                .map((queued) => (queued.payload.requestId === requestId ? offer : queued))
                .sort(byRequestedAt),
            );
          }
          return;
        }

        // The card is taken (an open offer, or the last word of one that is
        // about to close): the new request waits its turn, oldest first. Only a
        // request that is older than an offer the driver has not answered yet
        // goes ahead of it.
        if (current && currentPhase !== 'assigned') {
          if (currentPhase === 'idle' && offer.requestedAtMs < current.requestedAtMs) {
            enqueue(current);
            showOffer(offer);
          } else {
            enqueue(offer);
          }
          announceArrival();
          return;
        }

        showOffer(offer);
        announceArrival();
        return;
      }

      if (payload.type === 'request.taken') {
        if (wonRequestIdRef.current === payload.requestId) {
          return;
        }
        const active = broadcastRef.current;
        const onScreen = active?.requestId === payload.requestId;
        if (payload.winner === ambulanceId) {
          if (onScreen && active) {
            winMission(payload.requestId, active);
          }
          return;
        }
        // Another unit won. A backend frame is addressed to this user because
        // this unit was notified of the request, so it is acted on even when the
        // request is only a registry row. A demo frame reaches every client, so
        // there only the request on screen reacts.
        if (onScreen || fromWire) {
          lostToAnotherUnit(payload.requestId);
        }
        return;
      }

      if (payload.type === 'request.already-taken') {
        if (broadcastRef.current?.requestId !== payload.requestId) {
          return;
        }
        // The winner already owns this request; a late accept from another unit
        // must not overwrite their outcome.
        if (wonRequestIdRef.current === payload.requestId) {
          return;
        }
        lostToAnotherUnit(payload.requestId);
        return;
      }

      if (payload.type === 'request.rejected') {
        if (broadcastRef.current?.requestId !== payload.requestId) {
          return;
        }
        if (payload.rejected !== ambulanceId) {
          return;
        }
        // The arbiter refused the bid (e.g. wrong unit for a direct request).
        setPhase('rejected');
        setOutcomeMessage('Rechazada: no era la unidad destinataria');
        return;
      }

      if (payload.type === 'request.cancelled') {
        // The requester withdrew: remove the request from this inbox so no unit
        // can offer a mission that is no longer being asked for.
        dropQueued(payload.requestId);
        if (broadcastRef.current?.requestId !== payload.requestId) {
          return;
        }
        wonRequestIdRef.current = null;
        releaseSlot();
        return;
      }

      if (payload.type === 'request.expired' || payload.type === 'request.closed') {
        // The request is no longer active: TIMEOUT (it expired with no winner)
        // or TOMADA (the service was finished). Either way this inbox must stop
        // offering a mission nobody is asking for anymore. Only OUR open
        // broadcast reacts; the mission close is driven by finishService.
        dropQueued(payload.requestId);
        if (broadcastRef.current?.requestId !== payload.requestId) {
          return;
        }
        wonRequestIdRef.current = null;
        releaseSlot();
        return;
      }

      if (payload.type === 'request.arrived') {
        const active = missionRef.current;
        // Only OUR mission reacts, and only the FIRST arrival: a repeated event
        // must not reset the arrival instant (or any counter derived from it).
        if (active?.requestId !== payload.requestId || active.arrivedAt !== null) {
          return;
        }
        const next = { ...active, arrivedAt: Date.now() };
        missionRef.current = next;
        setMission(next);
        return;
      }

      if (payload.type === 'request.confirmed') {
        const active = missionRef.current;
        // The citizen confirmed: stamp it once so the toast and the timeline's
        // third entry appear, and never reopen the notice on a repeat.
        if (active?.requestId !== payload.requestId || active.confirmedAt !== null) {
          return;
        }
        const next = { ...active, confirmedAt: Date.now() };
        missionRef.current = next;
        setMission(next);
      }
    },
    [
      ambulanceId,
      announceArrival,
      winMission,
      lostToAnotherUnit,
      showOffer,
      enqueue,
      dropQueued,
      syncQueue,
      releaseSlot,
    ],
  );

  useEffect(() => {
    if (!port) {
      return;
    }
    return port.subscribe<unknown>(DESTINATIONS.solicitudes, (raw) => {
      if (!raw || typeof raw !== 'object') {
        return;
      }

      // The backend `flota` module speaks its own shape (no `type`, lifecycle in
      // `estado`). Validate and reconcile it first; a malformed wire frame is
      // dropped, never blindly cast.
      const wire = fromWireSolicitud(raw);
      if (wire) {
        const emergency =
          useEmergencyStore.getState().items.find((item) => item.id === wire.emergenciaId) ?? null;
        const frame = solicitudFrameFromWire(wire, {
          ownAmbulanceId: ambulanceId,
          ...(emergency
            ? {
                escena: emergency.ubicacion,
                tipo: emergency.descripcion,
                nivel: emergency.nivel,
              }
            : {}),
        });
        if (frame) {
          applyFrame(frame, true);
        }
        return;
      }

      applyFrame(raw as SolicitudPayload, false);
    });
  }, [port, ambulanceId, applyFrame]);

  // Auto-dismiss terminal outcomes so the request card never gets stuck.
  useEffect(() => {
    if (phase === 'taken' || phase === 'rejected' || phase === 'timeout') {
      const id = window.setTimeout(dismiss, TERMINAL_DISMISS_MS);
      return () => window.clearTimeout(id);
    }
    if (phase === 'assigned') {
      const id = window.setTimeout(clearActive, ASSIGNED_DISMISS_MS);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [phase, dismiss, clearActive]);

  const accept = useCallback(() => {
    const active = broadcastRef.current;
    if (!active) {
      return;
    }
    // The backend exposes accept/reject ONLY as REST: it has no @MessageMapping
    // for them, so publishing on the port would reach nobody.
    if (!isDemoMode()) {
      // FIX B: without a resolved unit the POST would carry an empty
      // `ambulanciaId` and the backend would answer 400, silently dropping the
      // request. Refuse honestly instead and keep the card open.
      if (!ambulanceId) {
        setOutcomeMessage(UNIT_UNRESOLVED_REASON);
        return;
      }
      // The request id must be a real server UUID: a fixture `REQ-…` id (e.g. a
      // leftover from a source that did not come from the backend) would only
      // 400. Refuse honestly before sending anything.
      if (!isUuid(active.requestId)) {
        setOutcomeMessage(UNKNOWN_REQUEST_REASON);
        return;
      }
      if (acceptingRef.current) {
        return;
      }
      acceptingRef.current = true;
      setAccepting(true);
      setPhase('submitting');
      setOutcomeMessage('Enviando…');
      void aceptarSolicitud(active.requestId, ambulanceId)
        .then((outcome) => {
          const broadcast = broadcastRef.current;
          // The request moved on while the response was in flight: adopt nothing.
          if (broadcast?.requestId !== active.requestId) {
            return;
          }
          // The server is the source of truth. `winner=false` and the 409
          // CAS-lost response both mean "someone else got it first".
          if (outcome.winner) {
            winMission(active.requestId, broadcast);
          } else {
            lostToAnotherUnit(active.requestId);
          }
        })
        .catch((error: unknown) => {
          // Lost to another unit: the request leaves the screen at once, with
          // its notice. Called before the "moved on" check below on purpose: if
          // the server's push already cleared the card, this is a no-op.
          if (isLostAccept(error)) {
            lostToAnotherUnit(active.requestId);
            return;
          }
          // The unit had declined it before: the row is marked, so its detail
          // stops offering an accept the server will keep refusing.
          if (isAlreadyRejected(error)) {
            recordOwnRejection(active.requestId);
          }
          const broadcast = broadcastRef.current;
          if (broadcast?.requestId !== active.requestId) {
            return;
          }
          // Any other refusal (the unit is busy, the request is unknown...) is
          // shown as a terminal outcome instead of leaving the card stuck on
          // "Enviando…".
          setPhase('rejected');
          setOutcomeMessage(error instanceof Error ? error.message : 'No fue posible aceptar');
        })
        .finally(() => {
          acceptingRef.current = false;
          setAccepting(false);
        });
      return;
    }

    if (!port) {
      return;
    }
    // Demo: submitting only — the driver has NOT won yet. Wait for the arbiter.
    setPhase('submitting');
    setOutcomeMessage('Enviando…');
    port.publish<SolicitudAcceptPayload>(DESTINATIONS.solicitudes, {
      type: 'solicitud.accept',
      requestId: active.requestId,
      ambulanceId,
    });
  }, [port, ambulanceId, winMission, lostToAnotherUnit, recordOwnRejection]);

  const reject = useCallback(() => {
    const active = broadcastRef.current;
    if (!active) {
      return;
    }
    // Backend: the decline is a REST command too. It leaves the request
    // PENDIENTE for the other units (AC4), so this is fire-and-forget with the
    // local rejection recorded once it lands.
    if (!isDemoMode()) {
      // FIX B: same guard as accept — no unit, no reject.
      if (!ambulanceId) {
        setOutcomeMessage(UNIT_UNRESOLVED_REASON);
        return;
      }
      // Same id guard as accept: never decline an id the backend does not know.
      if (!isUuid(active.requestId)) {
        setOutcomeMessage(UNKNOWN_REQUEST_REASON);
        return;
      }
      void rechazarSolicitud(active.requestId, ambulanceId)
        .then(() => {
          // The server recorded the decline: the row is marked at once, whether
          // or not the card is still the one on screen.
          recordOwnRejection(active.requestId);
          const broadcast = broadcastRef.current;
          if (broadcast?.requestId !== active.requestId) {
            return;
          }
          setPhase('rejected');
          setOutcomeMessage('Solicitud rechazada');
        })
        .catch((error: unknown) => {
          const broadcast = broadcastRef.current;
          if (broadcast?.requestId !== active.requestId) {
            return;
          }
          setPhase('rejected');
          setOutcomeMessage(error instanceof Error ? error.message : 'No fue posible rechazar');
        });
      return;
    }

    if (!port) {
      dismiss();
      return;
    }
    port.publish<SolicitudRejectPayload>(DESTINATIONS.solicitudes, {
      type: 'solicitud.reject',
      requestId: active.requestId,
      ambulanceId,
    });
    recordOwnRejection(active.requestId);
    setPhase('rejected');
    setOutcomeMessage('Solicitud rechazada');
  }, [port, ambulanceId, dismiss, recordOwnRejection]);

  /**
   * A registry row was declined from its detail. Besides recording it, the card
   * is freed when that same request was the open offer: a request the unit
   * declined is never left on screen asking for an answer.
   */
  const declineRow = useCallback(
    (requestId: string) => {
      recordOwnRejection(requestId);
      if (broadcastRef.current?.requestId === requestId) {
        releaseSlot();
      }
    },
    [recordOwnRejection, releaseSlot],
  );

  /**
   * Answers a registry row by its OWN id, without going through the inbox's
   * single broadcast slot. It mirrors `accept`/`reject` exactly — same guards,
   * same transports, same honest outcome — but targets the row the driver
   * selected. The backend stays the arbiter: a win opens the mission, a lost
   * CAS or a refusal lands in `responseOutcome`, and this client never
   * announces a result the server did not give.
   */
  const respondTo = useCallback(
    (solicitud: SolicitudAmbulancia, action: 'accept' | 'reject') => {
      const requestId = solicitud.id;
      const source: MissionSource = {
        zonaId: solicitud.zonaId,
        tipo: solicitud.tipo,
        ...(solicitud.ubicacion ? { escena: solicitud.ubicacion } : {}),
      };

      if (action === 'reject') {
        if (isDemoMode()) {
          if (!port) {
            return;
          }
          port.publish<SolicitudRejectPayload>(DESTINATIONS.solicitudes, {
            type: 'solicitud.reject',
            requestId,
            ambulanceId,
          });
          declineRow(requestId);
          setResponseOutcome({ requestId, phase: 'rejected', message: 'Solicitud rechazada' });
          return;
        }
        // FIX B: without a resolved unit there is no `ambulanciaId` to send, so
        // the POST would only 400. Refuse honestly and keep the row usable.
        if (!ambulanceId) {
          setResponseOutcome({ requestId, phase: 'rejected', message: UNIT_UNRESOLVED_REASON });
          return;
        }
        // Same id guard as the broadcast path: never send an id the backend does
        // not know (`REQ-…`), which would only 400.
        if (!isUuid(requestId)) {
          setResponseOutcome({ requestId, phase: 'rejected', message: UNKNOWN_REQUEST_REASON });
          return;
        }
        if (respondingRef.current) {
          return;
        }
        respondingRef.current = true;
        void rechazarSolicitud(requestId, ambulanceId)
          .then(() => {
            declineRow(requestId);
            setResponseOutcome({ requestId, phase: 'rejected', message: 'Solicitud rechazada' });
          })
          .catch((error: unknown) => {
            setResponseOutcome({
              requestId,
              phase: 'rejected',
              message: error instanceof Error ? error.message : 'No fue posible rechazar',
            });
          })
          .finally(() => {
            respondingRef.current = false;
          });
        return;
      }

      // Accept: the backend exposes it ONLY as REST, so in demo the relay is the
      // arbiter. Submitting is announced, then the SERVER's answer decides.
      if (isDemoMode()) {
        if (!port) {
          return;
        }
        setResponseOutcome({ requestId, phase: 'submitting', message: 'Enviando…' });
        port.publish<SolicitudAcceptPayload>(DESTINATIONS.solicitudes, {
          type: 'solicitud.accept',
          requestId,
          ambulanceId,
        });
        return;
      }
      // FIX B: without a resolved unit there is no `ambulanciaId` to send, so
      // the POST would only 400. Refuse honestly and keep the row usable.
      if (!ambulanceId) {
        setResponseOutcome({ requestId, phase: 'rejected', message: UNIT_UNRESOLVED_REASON });
        return;
      }
      // Same id guard as the broadcast path: never send an id the backend does
      // not know (`REQ-…`), which would only 400.
      if (!isUuid(requestId)) {
        setResponseOutcome({ requestId, phase: 'rejected', message: UNKNOWN_REQUEST_REASON });
        return;
      }
      if (respondingRef.current) {
        return;
      }
      respondingRef.current = true;
      setResponseOutcome({ requestId, phase: 'submitting', message: 'Enviando…' });
      void aceptarSolicitud(requestId, ambulanceId)
        .then((outcome) => {
          // The server is the source of truth. `winner=false` and the 409
          // CAS-lost response both mean "someone else got it first".
          if (outcome.winner) {
            winMission(requestId, source);
            setResponseOutcome({ requestId, phase: 'assigned', message: 'Te la asignaron' });
          } else {
            lostToAnotherUnit(requestId);
          }
        })
        .catch((error: unknown) => {
          // Lost to another unit: the row leaves the registry at once, with its
          // notice, instead of staying "Pendiente" with live buttons.
          if (isLostAccept(error)) {
            lostToAnotherUnit(requestId);
            return;
          }
          // The unit had declined it before: the row is marked and stops
          // offering an accept the server will keep refusing.
          if (isAlreadyRejected(error)) {
            declineRow(requestId);
          }
          // Any other refusal is shown honestly instead of leaving the row stuck
          // on "Enviando…".
          setResponseOutcome({
            requestId,
            phase: 'rejected',
            message: error instanceof Error ? error.message : 'No fue posible aceptar',
          });
        })
        .finally(() => {
          respondingRef.current = false;
        });
    },
    [port, ambulanceId, winMission, lostToAnotherUnit, declineRow],
  );

  const offerPending = useCallback(
    (solicitud: SolicitudAmbulancia) => {
      if (solicitud.estado !== 'PENDING') {
        return;
      }
      // Already ours: there is nothing left to offer. A request that is on
      // screen or waiting is NOT restarted by the frame handler; the server's
      // deadline only corrects its countdown.
      if (
        missionRef.current?.requestId === solicitud.id ||
        wonRequestIdRef.current === solicitud.id
      ) {
        return;
      }
      // This unit already declined it (EP-04.F2.US5): the request is listed in
      // the registry, but it is not offered again, not even after a reload.
      if (ambulanceId && (solicitud.ambulanciasRechazaron ?? []).includes(ambulanceId)) {
        return;
      }
      const deadline = Date.parse(solicitud.timeoutEn);
      if (Number.isFinite(deadline) && deadline <= Date.now()) {
        return;
      }
      const requested = Date.parse(solicitud.solicitadaEn);
      const emergency =
        useEmergencyStore.getState().items.find((item) => item.id === solicitud.emergenciaId) ??
        null;
      const escena = solicitud.ubicacion ?? emergency?.ubicacion;
      const frame: SolicitudBroadcastPayload = {
        type: 'solicitud.broadcast',
        requestId: solicitud.id,
        emergenciaId: solicitud.emergenciaId,
        zonaId: solicitud.zonaId,
        tipo: solicitud.tipo || emergency?.descripcion || '',
        ...(emergency?.nivel ? { nivel: emergency.nivel } : {}),
        ...(escena ? { escena } : {}),
        timeoutEn: solicitud.timeoutEn,
        notificadas: solicitud.ambulanciasNotificadas,
        mode: 'broadcast',
        notifiedCount: solicitud.ambulanciasNotificadas.length,
        // The real window length, so the card derives when the request was
        // raised instead of taking the moment it was read back.
        ...(Number.isFinite(deadline) && Number.isFinite(requested) && deadline > requested
          ? { timeoutMs: deadline - requested }
          : {}),
      };
      // The server already filtered by this unit, exactly like a per-user push.
      applyFrame(frame, true);
    },
    [applyFrame, ambulanceId],
  );

  const restoreMission = useCallback(
    (solicitud: SolicitudAmbulancia) => {
      if (missionRef.current !== null) {
        return;
      }
      if (solicitud.estado !== 'ASSIGNED' && solicitud.estado !== 'CONFIRMED') {
        return;
      }
      if (!ambulanceId || solicitud.ambulanciaAsignadaId !== ambulanceId) {
        return;
      }
      const emergency =
        useEmergencyStore.getState().items.find((item) => item.id === solicitud.emergenciaId) ??
        null;
      const scene = solicitud.ubicacion ?? emergency?.ubicacion;
      const from = positionRef.current ?? scene;
      const requested = Date.parse(solicitud.solicitadaEn);
      const arrived = solicitud.llegadaEn ? Date.parse(solicitud.llegadaEn) : Number.NaN;
      const restored: Mission = {
        requestId: solicitud.id,
        zonaId: solicitud.zonaId,
        tipo: solicitud.tipo || emergency?.descripcion || '',
        ...(emergency?.nivel ? { nivel: emergency.nivel } : {}),
        ...(scene ? { escena: scene } : {}),
        etaMinutes: from && scene ? etaMinutes(from, scene) : 0,
        // The server does not keep the accept instant: the request's own
        // creation is the closest real one, never an invented "just now".
        acceptedAt: Number.isFinite(requested) ? requested : Date.now(),
        arrivedAt: Number.isFinite(arrived) ? arrived : null,
        confirmedAt: solicitud.estado === 'CONFIRMED' ? Date.now() : null,
      };
      wonRequestIdRef.current = solicitud.id;
      missionRef.current = restored;
      // Same phase a live win leaves behind: with it the page treats the mission
      // as the owner of the rail, and not an (absent) open offer.
      setPhase('assigned');
      setMission(restored);
    },
    [ambulanceId],
  );

  const notifyTimeout = useCallback(() => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'submitting') {
      setPhase('timeout');
      setOutcomeMessage('La solicitud expiró');
    }
  }, []);

  const declareArrival = useCallback(() => {
    const active = missionRef.current;
    if (!active) {
      return;
    }
    // Backend: arrival is a REST command, because there is no @MessageMapping
    // inbound. The SERVER's response is adopted: on 200 the milestone is real,
    // so the mission advances locally without waiting for a push (the arrival
    // push targets the requester, not this driver).
    if (!isDemoMode()) {
      if (!ambulanceId) {
        setOutcomeMessage(UNIT_UNRESOLVED_REASON);
        return;
      }
      void declararLlegada(active.requestId, ambulanceId)
        .then(() => {
          const current = missionRef.current;
          if (current?.requestId !== active.requestId || current.arrivedAt !== null) {
            return;
          }
          const next = { ...current, arrivedAt: Date.now() };
          missionRef.current = next;
          setMission(next);
        })
        .catch((error: unknown) => {
          setOutcomeMessage(
            error instanceof Error ? error.message : 'No fue posible declarar la llegada',
          );
        });
      return;
    }

    if (!port) {
      return;
    }
    // Demo: publish only — the mission advances when the relay echoes
    // `request.arrived`, so this client never decides the state on its own
    // (server is the truth). This branch is unchanged.
    port.publish<SolicitudLlegadaPayload>(DESTINATIONS.solicitudes, {
      type: 'solicitud.llegada',
      requestId: active.requestId,
      ambulanceId,
    });
  }, [port, ambulanceId]);

  const finishService = useCallback(async (): Promise<boolean> => {
    const active = missionRef.current;
    if (!active) {
      return false;
    }
    // Backend: finishing is a REST command (there is no @MessageMapping
    // inbound). The backend closes the request AND releases the unit in the same
    // atomic operation, so the mission is only cleared once the server confirms;
    // a failure is surfaced and the mission stays for a retry.
    if (!isDemoMode()) {
      if (!ambulanceId) {
        setOutcomeMessage(UNIT_UNRESOLVED_REASON);
        return false;
      }
      try {
        await finalizarSolicitud(active.requestId, ambulanceId);
      } catch (error: unknown) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'No fue posible finalizar el servicio.';
        setOutcomeMessage(message);
        toast(message);
        return false;
      }
    }
    // Local end of the mission: the page republishes the unit as available. In
    // demo this runs synchronously, so the behaviour is unchanged.
    missionRef.current = null;
    setMission(null);
    setOutcomeMessage(null);
    return true;
  }, [ambulanceId]);

  const missionPhase: DriverMissionPhase =
    mission?.confirmedAt != null
      ? 'confirmed'
      : mission?.arrivedAt != null
        ? 'arrived'
        : 'en_route';

  return {
    // The offer surface is gated by the connection; the mission below is not.
    broadcast: online ? broadcast : null,
    queuedIds: online ? queuedIds : NO_QUEUED,
    deadlineMs,
    windowMs,
    requestedAtMs,
    phase,
    accepting,
    outcomeMessage,
    responseOutcome,
    mission,
    missionPhase,
    accept,
    reject,
    respondTo,
    notifyTimeout,
    offerPending,
    restoreMission,
    declareArrival,
    finishService,
    dismiss,
  };
}
