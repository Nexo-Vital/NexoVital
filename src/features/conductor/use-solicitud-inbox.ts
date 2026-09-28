import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { isUuid } from '@/features/ciudadano/citizen-request';
import { formatDistance } from '@/features/ciudadano/citizen-view';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { distanceKm, etaMinutes } from '@/lib/geo';
import { isDemoMode } from '@/services/apiClient';
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
import type { EmergencyLevel, Ubicacion } from '@/types/domain';
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

export interface SolicitudInboxState {
  broadcast: SolicitudBroadcastPayload | null;
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
  mission: Mission | null;
  /** Derived mission phase; `en_route` until the arrival event arrives. */
  missionPhase: DriverMissionPhase;
  accept: () => void;
  reject: () => void;
  /** Called by the request card when the countdown reaches zero. */
  notifyTimeout: () => void;
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
 */
export function useSolicitudInbox(
  port: RealtimePort | null,
  ambulanceId: string,
  currentPosition: Ubicacion | null,
): SolicitudInboxState {
  const [broadcast, setBroadcast] = useState<SolicitudBroadcastPayload | null>(null);
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [windowMs, setWindowMs] = useState(DEFAULT_WINDOW_MS);
  const [requestedAtMs, setRequestedAtMs] = useState<number | null>(null);
  const [phase, setPhase] = useState<SolicitudPhase>('idle');
  const [accepting, setAccepting] = useState(false);
  const [outcomeMessage, setOutcomeMessage] = useState<string | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);

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
   * Request id this unit has already won. The relay broadcasts
   * `request.already-taken` to every client, so without this guard the winner
   * would see their own "Assigned to you" overwritten by "Taken by <self>".
   */
  const wonRequestIdRef = useRef<string | null>(null);
  positionRef.current = currentPosition;
  phaseRef.current = phase;
  missionRef.current = mission;

  const dismiss = useCallback(() => {
    broadcastRef.current = null;
    setBroadcast(null);
    setRequestedAtMs(null);
    acceptingRef.current = false;
    setAccepting(false);
    setPhase('idle');
    setOutcomeMessage(null);
  }, []);

  const clearActive = useCallback(() => {
    broadcastRef.current = null;
    setBroadcast(null);
    setRequestedAtMs(null);
    acceptingRef.current = false;
    setAccepting(false);
  }, []);

  /**
   * Opens the mission for a WIN. Shared by the realtime `request.taken` path
   * (demo) and the REST accept path (backend): the server decided the winner in
   * both cases, so the client only adopts it.
   */
  const winMission = useCallback((requestId: string, active: SolicitudBroadcastPayload) => {
    wonRequestIdRef.current = requestId;
    const scene = active.escena;
    const from = positionRef.current ?? scene;
    setPhase('assigned');
    setOutcomeMessage('Te la asignaron');
    setMission({
      requestId,
      zonaId: active.zonaId,
      tipo: active.tipo,
      nivel: active.nivel,
      ...(scene ? { escena: scene } : {}),
      // No scene means no honest ETA: 0 rather than an invented figure.
      etaMinutes: from && scene ? etaMinutes(from, scene) : 0,
      acceptedAt: Date.now(),
      arrivedAt: null,
      confirmedAt: null,
    });
  }, []);

  /**
   * U4: ephemeral, non-blocking notice the moment a request arrives, at the one
   * place the request becomes active. It disappears on its own (the toast store
   * auto-dismisses) and never gates the inbox. The sound is attempted on the same
   * instant; `playRequestDing` reports `false` while audio is locked, so the UI
   * (the rail's sound control) is the honest source of that state.
   */
  const announceArrival = useCallback((active: SolicitudBroadcastPayload) => {
    const from = positionRef.current;
    const distance = from && active.escena ? distanceKm(from, active.escena) : null;
    const suffix = distance !== null ? ` a ${formatDistance(distance)}` : '';
    toast(`Nueva solicitud de ambulancia${suffix}`);
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
        const active: SolicitudBroadcastPayload = { ...payload, type: 'solicitud.broadcast' };
        const deadline =
          typeof active.timeoutEn === 'string' ? Date.parse(active.timeoutEn) : Number.NaN;
        const valid = Number.isFinite(deadline);
        broadcastRef.current = active;
        wonRequestIdRef.current = null;
        setBroadcast(active);
        setDeadlineMs(valid ? deadline : Date.now() + DEFAULT_WINDOW_MS);
        setWindowMs(valid ? Math.max(1000, deadline - Date.now()) : DEFAULT_WINDOW_MS);
        // The payload has no explicit request timestamp: derive it from the
        // deadline minus the window length, or fall back to the receipt instant.
        setRequestedAtMs(
          valid && typeof active.timeoutMs === 'number' ? deadline - active.timeoutMs : Date.now(),
        );
        setPhase('idle');
        setOutcomeMessage(null);
        announceArrival(active);
        return;
      }

      if (payload.type === 'request.taken') {
        const active = broadcastRef.current;
        if (active?.requestId !== payload.requestId) {
          return;
        }
        if (wonRequestIdRef.current === payload.requestId) {
          return;
        }
        if (payload.winner === ambulanceId) {
          winMission(payload.requestId, active);
        } else {
          setPhase('taken');
          setOutcomeMessage(`Tomada por ${payload.winner}`);
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
        setPhase('taken');
        setOutcomeMessage(`Tomada por ${payload.winner}`);
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
        if (broadcastRef.current?.requestId !== payload.requestId) {
          return;
        }
        broadcastRef.current = null;
        wonRequestIdRef.current = null;
        setBroadcast(null);
        setDeadlineMs(null);
        setRequestedAtMs(null);
        setPhase('idle');
        setOutcomeMessage(null);
        return;
      }

      if (payload.type === 'request.expired' || payload.type === 'request.closed') {
        // The request is no longer active: TIMEOUT (it expired with no winner)
        // or TOMADA (the service was finished). Either way this inbox must stop
        // offering a mission nobody is asking for anymore. Only OUR open
        // broadcast reacts; the mission close is driven by finishService.
        if (broadcastRef.current?.requestId !== payload.requestId) {
          return;
        }
        broadcastRef.current = null;
        wonRequestIdRef.current = null;
        setBroadcast(null);
        setDeadlineMs(null);
        setRequestedAtMs(null);
        setPhase('idle');
        setOutcomeMessage(null);
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
    [ambulanceId, announceArrival, winMission],
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
            setPhase('taken');
            setOutcomeMessage('Tomada por otra unidad');
          }
        })
        .catch((error: unknown) => {
          const broadcast = broadcastRef.current;
          if (broadcast?.requestId !== active.requestId) {
            return;
          }
          // A 409 is the backend denying or losing the race: show it honestly as
          // a terminal outcome instead of leaving the card stuck on "Enviando…".
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
  }, [port, ambulanceId, winMission]);

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
    setPhase('rejected');
    setOutcomeMessage('Solicitud rechazada');
  }, [port, ambulanceId, dismiss]);

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
    broadcast,
    deadlineMs,
    windowMs,
    requestedAtMs,
    phase,
    accepting,
    outcomeMessage,
    mission,
    missionPhase,
    accept,
    reject,
    notifyTimeout,
    declareArrival,
    finishService,
    dismiss,
  };
}
