import { useCallback, useEffect, useRef, useState } from 'react';
import { etaMinutes } from '@/lib/geo';
import {
  DESTINATIONS,
  type RealtimePort,
  type SolicitudAcceptPayload,
  type SolicitudBroadcastPayload,
  type SolicitudPayload,
  type SolicitudRejectPayload,
} from '@/shared/realtime';
import type { EmergencyLevel, Ubicacion } from '@/types/domain';

export type SolicitudPhase = 'idle' | 'submitting' | 'assigned' | 'taken' | 'rejected' | 'timeout';

export interface Mission {
  requestId: string;
  zonaId: string;
  tipo: string;
  nivel: EmergencyLevel;
  escena: Ubicacion;
  etaMinutes: number;
}

export interface SolicitudInboxState {
  broadcast: SolicitudBroadcastPayload | null;
  /** Absolute deadline (epoch ms) of the accept window. */
  deadlineMs: number | null;
  /** Total accept window (ms), used by the countdown ring. */
  windowMs: number;
  phase: SolicitudPhase;
  /** Human-readable outcome; announced through aria-live by the overlay. */
  outcomeMessage: string | null;
  mission: Mission | null;
  accept: () => void;
  reject: () => void;
  /** Called by the overlay when the countdown reaches zero. */
  notifyTimeout: () => void;
  dismiss: () => void;
}

const DEFAULT_WINDOW_MS = 45_000;
const TERMINAL_DISMISS_MS = 2600;
const ASSIGNED_DISMISS_MS = 1600;

/**
 * Driver inbox for /queue/solicitudes.
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
  const [phase, setPhase] = useState<SolicitudPhase>('idle');
  const [outcomeMessage, setOutcomeMessage] = useState<string | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);

  const broadcastRef = useRef<SolicitudBroadcastPayload | null>(null);
  const phaseRef = useRef<SolicitudPhase>('idle');
  const positionRef = useRef<Ubicacion | null>(currentPosition);
  /**
   * Request id this unit has already won. The relay broadcasts
   * `request.already-taken` to every client, so without this guard the winner
   * would see their own "Assigned to you" overwritten by "Taken by <self>".
   */
  const wonRequestIdRef = useRef<string | null>(null);
  positionRef.current = currentPosition;
  phaseRef.current = phase;

  const dismiss = useCallback(() => {
    broadcastRef.current = null;
    setBroadcast(null);
    setPhase('idle');
    setOutcomeMessage(null);
  }, []);

  const clearActive = useCallback(() => {
    broadcastRef.current = null;
    setBroadcast(null);
  }, []);

  useEffect(() => {
    if (!port) {
      return;
    }
    return port.subscribe<SolicitudPayload>(DESTINATIONS.solicitudes, (payload) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }

      if (payload.type === 'solicitud.broadcast' || payload.type === 'solicitud.direct') {
        // Direct mode is addressed to one unit: everyone else ignores the frame
        // entirely (no overlay, no accept bid). Broadcast reaches every unit.
        if (payload.type === 'solicitud.direct' && payload.targetAmbulanceId !== ambulanceId) {
          return;
        }
        // Normalize to the broadcast shape; `mode`/`targetAmbulanceId` survive
        // so the overlay can label the two delivery modes distinctly.
        const active: SolicitudBroadcastPayload = { ...payload, type: 'solicitud.broadcast' };
        const deadline = Date.parse(active.timeoutEn);
        const valid = Number.isFinite(deadline);
        broadcastRef.current = active;
        wonRequestIdRef.current = null;
        setBroadcast(active);
        setDeadlineMs(valid ? deadline : Date.now() + DEFAULT_WINDOW_MS);
        setWindowMs(valid ? Math.max(1000, deadline - Date.now()) : DEFAULT_WINDOW_MS);
        setPhase('idle');
        setOutcomeMessage(null);
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
          const from = positionRef.current ?? active.escena;
          setPhase('assigned');
          setOutcomeMessage('Assigned to you');
          setMission({
            requestId: payload.requestId,
            zonaId: active.zonaId,
            tipo: active.tipo,
            nivel: active.nivel,
            escena: active.escena,
            etaMinutes: etaMinutes(from, active.escena),
          });
        } else {
          setPhase('taken');
          setOutcomeMessage(`Taken by ${payload.winner}`);
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
        setOutcomeMessage(`Taken by ${payload.winner}`);
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
        setOutcomeMessage('Rejected: not the targeted unit');
      }
    });
  }, [port, ambulanceId]);

  // Auto-dismiss terminal outcomes so the overlay never gets stuck.
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
    setOutcomeMessage('Submitting…');
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
    setOutcomeMessage('Request rejected');
  }, [port, ambulanceId, dismiss]);

  const notifyTimeout = useCallback(() => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'submitting') {
      setPhase('timeout');
      setOutcomeMessage('Request timed out');
    }
  }, []);

  return {
    broadcast,
    deadlineMs,
    windowMs,
    phase,
    outcomeMessage,
    mission,
    accept,
    reject,
    notifyTimeout,
    dismiss,
  };
}
