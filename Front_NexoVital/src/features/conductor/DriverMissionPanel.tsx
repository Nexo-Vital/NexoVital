import { Check, Flag, Info, Navigation } from 'lucide-react';
import { formatDistance } from '@/features/ciudadano/citizen-view';
import {
  DRIVER_ARRIVED_STEP,
  DRIVER_EN_ROUTE_STEP,
  DRIVER_TRACKING_STEPS,
  type TimelineEntry,
  TrackingSteps,
  TrackingTimeline,
} from '@/features/seguimiento/tracking';
import { EMERGENCY_LEVEL_META } from '@/features/solicitudes/request-status';
import { cn } from '@/lib/utils';
import type { EmergencyLevel } from '@/types/domain';
import type { DriverMissionPhase } from './use-solicitud-inbox';

interface DriverMissionPanelProps {
  /** Request type as the payload declares it. */
  tipo: string;
  /** Declared severity; a citizen request has none and shows no chip. */
  nivel?: EmergencyLevel;
  /** Distance from the driver to the scene, or null without a position. */
  distanceKm: number | null;
  /** Computed ETA in minutes, or null without a position. */
  etaMin: number | null;
  /** Real scene label: the declared zone, or the reported coordinates. */
  locationLabel: string;
  /** Live outcome text, announced to screen readers by the rail. */
  outcomeMessage: string | null;
  /** Mission lifecycle: `en_route` is `C.d4`, `arrived`/`confirmed` are `C.d5`. */
  phase: DriverMissionPhase;
  /** Real instants of each step, for the `C.d5` timeline. */
  acceptedAt: number | null;
  arrivedAt: number | null;
  confirmedAt: number | null;
  /** Publishes the arrival; the relay echoes it before the screen advances. */
  onDeclareArrival: () => void;
  /** Ends the mission so the unit becomes available again. */
  onFinish: () => void;
}

const PRIMARY_BUTTON =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Driver mission rail. It renders the two live stages of the loop:
 *
 *   - `C.d4` ("Solicitud aceptada"): the computed ETA, the live step and the
 *     mission's identity, with "Declarar llegada" now ENABLED.
 *   - `C.d5` ("Llegaste al destino"): the stepper with "Llegada" as the active
 *     step (NOT the mockup's literal "Finalizada", which the driver has not
 *     reached), the real timeline ("Aceptaste la solicitud" / "Declaraste la
 *     llegada", plus the citizen's confirmation once it arrives), with
 *     "Finalizar servicio".
 */
export function DriverMissionPanel({
  tipo,
  nivel,
  distanceKm,
  etaMin,
  locationLabel,
  outcomeMessage,
  phase,
  acceptedAt,
  arrivedAt,
  confirmedAt,
  onDeclareArrival,
  onFinish,
}: DriverMissionPanelProps) {
  const levelMeta = nivel ? EMERGENCY_LEVEL_META[nivel] : null;
  const detail = `${distanceKm !== null ? formatDistance(distanceKm) : 'Sin ubicación'} · ${locationLabel}`;
  const arrived = phase !== 'en_route';

  // Real instants only: the third entry exists once the citizen confirmed, so
  // the toast and the timeline never announce a step that has not happened.
  const timeline: TimelineEntry[] = [
    { text: 'Aceptaste la solicitud', at: acceptedAt },
    { text: 'Declaraste la llegada', at: arrivedAt },
    ...(confirmedAt !== null
      ? [{ text: 'El ciudadano confirmó la llegada', at: confirmedAt }]
      : []),
  ];

  return (
    <>
      <section
        aria-label="Estado de la misión"
        className="flex flex-col gap-3 rounded-nv-lg bg-white p-4 shadow-nv-card"
      >
        {!arrived ? (
          <>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-nv-pill bg-nv-teal px-2.5 py-1 font-semibold text-nv-navy text-xs">
                <Check className="size-3.5" aria-hidden />
                Solicitud aceptada
              </span>
              {levelMeta && (
                <span
                  className={cn(
                    'ml-auto shrink-0 rounded-nv-pill border px-2.5 py-1 font-semibold text-xs',
                    levelMeta.borderClass,
                    levelMeta.textClass,
                  )}
                >
                  {levelMeta.label}
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-2.5">
              <b className="tabular font-bold text-[34px] leading-10 tracking-tight">
                {etaMin !== null ? `${etaMin} min` : '—'}
              </b>
              <span className="text-nv-navy-400 text-sm">{detail}</span>
            </div>

            <TrackingSteps
              steps={DRIVER_TRACKING_STEPS}
              activeIndex={DRIVER_EN_ROUTE_STEP}
              label="Progreso de la misión"
            />

            <div className="flex flex-col gap-1.5 rounded-nv-md border border-nv-line bg-nv-mint p-3">
              <div className="flex items-center gap-2">
                <Navigation className="size-4 text-nv-navy-600" aria-hidden />
                <span className="nv-label text-nv-navy-400">Misión actual</span>
              </div>
              <p className="font-medium text-sm">{tipo}</p>
            </div>

            <p className="flex items-start gap-2 rounded-nv-md bg-nv-mint p-3 text-nv-navy-400 text-xs leading-[18px]">
              <Info className="mt-0.5 size-4 shrink-0 text-nv-navy-600" aria-hidden />
              <span>Mientras estés ocupada no recibirás nuevas solicitudes.</span>
            </p>

            <p role="status" aria-live="polite" className="min-h-5 font-medium text-ok text-xs">
              {outcomeMessage ?? 'Solicitud aceptada'}
            </p>
          </>
        ) : (
          <>
            <TrackingSteps
              steps={DRIVER_TRACKING_STEPS}
              activeIndex={DRIVER_ARRIVED_STEP}
              label="Progreso de la misión"
            />
            <TrackingTimeline entries={timeline} label="Línea de tiempo de la misión" />
          </>
        )}
      </section>

      {!arrived ? (
        <>
          <button type="button" onClick={onDeclareArrival} className={PRIMARY_BUTTON}>
            <Flag className="size-5" aria-hidden />
            Declarar llegada
          </button>
          <p className="text-nv-navy-400 text-xs">
            Al declarar la llegada, el ciudadano deberá confirmar que estás con él.
          </p>
        </>
      ) : (
        <>
          <button type="button" onClick={onFinish} className={PRIMARY_BUTTON}>
            <Check className="size-5" aria-hidden />
            Finalizar servicio
          </button>
          <p className="text-nv-navy-400 text-xs">
            Al finalizar, tu ambulancia vuelve a quedar disponible para nuevas solicitudes.
          </p>
        </>
      )}
    </>
  );
}
