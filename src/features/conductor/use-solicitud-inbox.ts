import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { formatDistance } from '@/features/ciudadano/citizen-view';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { distanceKm, etaMinutes } from '@/lib/geo';
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

export type SolicitudPhase = 'idle' | 'submitting' | 'assigned' | 'taken' | 'rejected' | 'timeout';

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
  /** Ends the mission locally; the unit is free again (the page republishes). */
  finishService: () => void;
  dismiss: () => void;
}

const DEFAULT_WINDOW_MS = 45_000;
const TERMINAL_DISMISS_MS = 2600;
const ASSIGNED_DISMISS_MS = 1600;

/**
 * Driver inbox for /user/queue/solicitudes.
 *
 * The accept is a BID (rule C2): this hook only publishes `solicitud.accept`
 * and waits for the server-side arbiter. It never sets a winner itself; it
 * reacts to `request.taken` (won or lost) and `request.already-taken`.
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
  const [outcomeMessage, setOutcomeMessage] = useState<string | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);

  const broadcastRef = useRef<SolicitudBroadcastPayload | null>(null);
  const phaseRef = useRef<SolicitudPhase>('idle');
  const missionRef = useRef<Mission | null>(null);
  const positionRef = useRef<Ubicacion | null>(currentPosition);
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
    setPhase('idle');
    setOutcomeMessage(null);
  }, []);

  const clearActive = useCallback(() => {
    broadcastRef.current = null;
    setBroadcast(null);
    setRequestedAtMs(null);
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
          wonRequestIdRef.current = payload.requestId;
          const scene = active.escena;
          const from = positionRef.current ?? scene;
          setPhase('assigned');
          setOutcomeMessage('Te la asignaron');
          setMission({
            requestId: payload.requestId,
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
    [ambulanceId, announceArrival],
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
    if (!port || !active) {
      return;
    }
    // Submitting only: the driver has NOT won yet. Wait for the arbiter.
    setPhase('submitting');
    setOutcomeMessage('Enviando…');
    port.publish<SolicitudAcceptPayload>(DESTINATIONS.solicitudes, {
      type: 'solicitud.accept',
      requestId: active.requestId,
      ambulanceId,
    });
  }, [port, ambulanceId]);

  const reject = useCallback(() => {
    const active = broadcastRef.current;
    if (!port || !active) {
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
    if (!port || !active) {
      return;
    }
    // Publish only: the mission advances when the relay echoes `request.arrived`,
    // so this client never decides the state on its own (server is the truth).
    port.publish<SolicitudLlegadaPayload>(DESTINATIONS.solicitudes, {
      type: 'solicitud.llegada',
      requestId: active.requestId,
      ambulanceId,
    });
  }, [port, ambulanceId]);

  const finishService = useCallback(() => {
    // Local end of the mission: the page republishes the unit as available.
    missionRef.current = null;
    setMission(null);
    setOutcomeMessage(null);
  }, []);

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
