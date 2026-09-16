import { ShieldAlert, Timer } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EMERGENCY_LEVEL_META } from '@/features/solicitudes/request-status';
import { useClock } from '@/hooks/use-clock';
import { formatCountdown } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SolicitudBroadcastPayload } from '@/shared/realtime';
import type { SolicitudPhase } from './use-solicitud-inbox';

interface CountdownRingProps {
  deadlineMs: number;
  windowMs: number;
  onTimeout: () => void;
}

/** SVG countdown ring; fires `onTimeout` exactly once when it hits zero. */
function CountdownRing({ deadlineMs, windowMs, onTimeout }: CountdownRingProps) {
  const now = useClock(250);
  const firedRef = useRef(false);
  const remainingMs = Math.max(0, deadlineMs - now.getTime());

  useEffect(() => {
    if (remainingMs <= 0 && !firedRef.current) {
      firedRef.current = true;
      onTimeout();
    }
  }, [remainingMs, onTimeout]);

  const ratio = windowMs > 0 ? Math.min(1, Math.max(0, remainingMs / windowMs)) : 0;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const secondsLeft = Math.ceil(remainingMs / 1000);

  return (
    <div
      className="relative grid size-16 shrink-0 place-items-center"
      role="timer"
      aria-label={`${secondsLeft} seconds left to accept`}
    >
      <svg viewBox="0 0 64 64" className="absolute inset-0 size-16 -rotate-90" aria-hidden>
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-border"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className="text-critical transition-[stroke-dashoffset] duration-200 ease-linear"
        />
      </svg>
      <span className="tabular font-semibold text-sm">
        {formatCountdown(new Date(deadlineMs).toISOString(), now)}
      </span>
    </div>
  );
}

interface IncomingRequestOverlayProps {
  broadcast: SolicitudBroadcastPayload;
  phase: SolicitudPhase;
  outcomeMessage: string | null;
  deadlineMs: number;
  windowMs: number;
  distanceKm: number | null;
  etaMin: number | null;
  onAccept: () => void;
  onReject: () => void;
  onTimeout: () => void;
}

/**
 * Uber-style incoming request card. The wrapper ignores pointer events so the
 * map behind it stays fully interactive; only the card captures taps.
 *
 * C2: Accept is a BID. The UI shows "Submitting…" and then reacts to the
 * arbiter outcome ("Assigned to you" / "Taken by AMB-xx").
 */
export function IncomingRequestOverlay({
  broadcast,
  phase,
  outcomeMessage,
  deadlineMs,
  windowMs,
  distanceKm,
  etaMin,
  onAccept,
  onReject,
  onTimeout,
}: IncomingRequestOverlayProps) {
  const levelMeta = EMERGENCY_LEVEL_META[broadcast.nivel];
  const decided = phase === 'assigned' || phase === 'taken' || phase === 'rejected';
  const isSubmitting = phase === 'submitting';

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[1200] flex justify-center p-3">
      <Card
        role="alertdialog"
        aria-label="Incoming emergency request"
        className={cn('pointer-events-auto w-full max-w-sm gap-3 border-event/60 p-4 shadow-lg')}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-event/15',
              levelMeta.textClass,
            )}
            aria-hidden
          >
            <ShieldAlert className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="nv-label text-event">
                {broadcast.mode === 'direct' ? 'Direct request' : 'Broadcast request'}
              </span>
              <Badge
                variant="outline"
                className={cn('gap-1', levelMeta.borderClass, levelMeta.textClass)}
              >
                <span className={cn('size-1.5 rounded-full', levelMeta.dotClass)} aria-hidden />
                {levelMeta.label}
              </Badge>
            </div>
            <p className="mt-1 truncate font-semibold text-sm">{broadcast.tipo}</p>
            <p className="text-muted-foreground text-xs">
              {broadcast.zonaId} · {broadcast.requestId}
            </p>
          </div>

          {!decided && (
            <CountdownRing deadlineMs={deadlineMs} windowMs={windowMs} onTimeout={onTimeout} />
          )}
        </div>

        <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2/60 px-3 py-2">
          <Timer className="size-4 text-muted-foreground" aria-hidden />
          <div className="flex flex-1 items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">To scene</span>
            <span className="tabular font-medium">
              {etaMin !== null ? `${etaMin} min` : '--'}
              {distanceKm !== null && (
                <span className="ml-2 text-muted-foreground">{distanceKm.toFixed(1)} km</span>
              )}
            </span>
          </div>
        </div>

        <p
          role="status"
          aria-live="assertive"
          className={cn(
            'min-h-5 text-xs',
            phase === 'assigned' && 'font-medium text-ok',
            phase === 'taken' && 'text-warning',
            phase === 'timeout' && 'text-critical',
            isSubmitting && 'text-muted-foreground',
          )}
        >
          {outcomeMessage ??
            (broadcast.mode === 'direct'
              ? `Addressed to ${broadcast.targetAmbulanceId ?? 'this unit'}. Only this unit was notified.`
              : 'Broadcast to several units. The first accept wins.')}
        </p>

        {!decided && (
          <div className="flex gap-2">
            <Button type="button" className="flex-1" onClick={onAccept} disabled={isSubmitting}>
              {isSubmitting ? 'Submitting…' : 'Accept'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={onReject}
              disabled={isSubmitting}
            >
              Reject
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
