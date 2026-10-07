import { useEffect, useRef } from 'react';
import { ApiError } from '@/services/apiClient';
import type { Ubicacion } from '@/types/domain';
import { reportarPosicion } from './fleet-api';

/** How often the driver console reports its position (EP-04.F1.US1, D2). */
export const POSITION_REPORT_INTERVAL_MS = 5000;

/** Answers that will not change by trying again: stop instead of insisting. */
const FINAL_STATUSES = [401, 403, 409];

interface PositionReportOptions {
  /** Report only while this is true (the driver is connected, off demo mode). */
  enabled: boolean;
  /** The driver's own unit; an empty id means "not resolved yet". */
  ambulanciaId: string;
  /** The driver's OWN position (GPS or "Simular posición"); `null` when unknown. */
  position: Ubicacion | null;
  heading: number | null;
}

/**
 * Reports the driver's position to the backend by REST every
 * `POSITION_REPORT_INTERVAL_MS` while enabled (EP-04.F1.US1, D1/D2).
 *
 * Rules, each one closing a failure the direct publish on `/topic/flota` had:
 *
 *   - Fixed cadence, not "on every GPS change": the load is constant and a
 *     parked vehicle still sends a heartbeat, which is what keeps it from being
 *     marked "sin señal" after 30 s. The first report leaves at once.
 *   - ONE request at a time. If a report is still in flight the cycle is
 *     skipped, so two reports can never reach the server inverted and leave the
 *     older position as the last one written.
 *   - Only an OWN position is reported. With none, nothing is sent: the unit's
 *     stored position is never echoed back as if a device had produced it.
 *   - A failed report is not retried on the spot; the next cycle sends the
 *     position the driver has THEN, which is the only one worth sending.
 *   - A final answer (401, 403, or 409 "the unit is not yours") stops the
 *     reporting for this unit instead of repeating it every cycle.
 *
 * The response is ignored on purpose: the position comes back to this client
 * through `/topic/flota`, the same way it reaches everyone else.
 */
export function usePositionReport({
  enabled,
  ambulanciaId,
  position,
  heading,
}: PositionReportOptions): void {
  // The interval reads the latest position from a ref, so a GPS update does not
  // tear the timer down: the cadence stays fixed whatever the device does.
  const latest = useRef({ position, heading });
  useEffect(() => {
    latest.current = { position, heading };
  }, [position, heading]);

  // Shared by every run of the effect below: a report sent before a quick
  // disconnect/reconnect still counts as in flight for the next run.
  const inFlight = useRef(false);

  const hasPosition = position !== null;
  useEffect(() => {
    if (!enabled || ambulanciaId === '' || !hasPosition) {
      return;
    }
    let stopped = false;
    const report = () => {
      const current = latest.current;
      if (stopped || inFlight.current || current.position === null) {
        return;
      }
      inFlight.current = true;
      reportarPosicion(ambulanciaId, current.position, current.heading)
        .catch((error: unknown) => {
          if (error instanceof ApiError && FINAL_STATUSES.includes(error.status)) {
            stopped = true;
          }
        })
        .finally(() => {
          inFlight.current = false;
        });
    };
    report();
    const timer = window.setInterval(report, POSITION_REPORT_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [enabled, ambulanciaId, hasPosition]);
}
