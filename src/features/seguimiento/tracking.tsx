import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Ambulancia } from '@/types/domain';

/**
 * Request tracking shared by the citizen (`C.c4`) and driver (`C.d4`) rails.
 *
 * Pure projections only: the step lists, the derived driver initials and the
 * clock formats. Every value is computed from real data — the assigned unit, the
 * request scene and the acceptance instant — so nothing is copied from the
 * mockup, which writes its times and distances by hand.
 */

/** Citizen steps (`C.c4`): "Solicitada / Aceptada / En camino / Llegó". */
export const CITIZEN_TRACKING_STEPS = ['Solicitada', 'Aceptada', 'En camino', 'Llegó'];

/** Driver steps (`C.d4`): "Aceptada / En camino / Llegada / Finalizada". */
export const DRIVER_TRACKING_STEPS = ['Aceptada', 'En camino', 'Llegada', 'Finalizada'];

/** 0-based index of "En camino" in each list: the step shown after an accept. */
export const CITIZEN_EN_ROUTE_STEP = 2;
export const DRIVER_EN_ROUTE_STEP = 1;

/**
 * 0-based index of the arrival step, per rail.
 *
 * The citizen list starts at "Solicitada", so index 3 is "Llegó" — the state the
 * citizen is genuinely in when the driver declares arrival. Correct as-is.
 *
 * The driver list starts at "Aceptada", so index 3 is "Finalizada". The mockup
 * (`C.d5`) writes `steps([...], 3)` and therefore lights "Finalizada" the moment
 * the driver declares arrival. That is a mockup DEFECT, not a design choice: the
 * driver has only just arrived and has not finished the service yet ("Finalizar
 * servicio" is still ahead). Advancing to index 3 marks "Llegada" as done and
 * highlights a step that has not happened — a lie to the user. So the driver
 * arrival step is index 2 ("Llegada"); "Finalizada" is only ever reached by
 * ending the service, which returns the rail to the map.
 */
export const CITIZEN_ARRIVED_STEP = 3;
export const DRIVER_ARRIVED_STEP = 2;

/** Wall clock of an absolute instant, as `H:MM` (the mockup's "9:47"). */
export function formatClockTime(atMs: number): string {
  const at = new Date(atMs);
  return `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** Wall clock an ETA lands on, as `H:MM` (the mockup's "llega 9:47"). */
export function formatArrivalClock(etaMin: number, now: Date): string {
  return formatClockTime(now.getTime() + etaMin * 60_000);
}

/** Elapsed time since an instant, as "hace N s"; minutes once past 59 s. */
export function formatElapsedSince(fromMs: number, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - fromMs) / 1000));
  return seconds < 60 ? `hace ${seconds} s` : `hace ${Math.floor(seconds / 60)} min`;
}

/** Initials for the driver avatar: first letter of the first two name words. */
export function driverInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export interface UnitDetailRow {
  label: string;
  value: string;
}

/**
 * "Unidad / Placa / Modelo / Tipo" from the assigned unit (mockup `C.c4`).
 *
 * `modelo` and `tipo` are optional in the domain: a unit created in the fleet
 * manager or hydrated from a live frame may not know them yet, so the row is
 * omitted instead of showing an invented vehicle.
 */
export function unitDetailRows(unit: Ambulancia): UnitDetailRow[] {
  const rows: UnitDetailRow[] = [
    { label: 'Unidad', value: unit.id },
    { label: 'Placa', value: unit.placa },
  ];
  if (unit.modelo) {
    rows.push({ label: 'Modelo', value: unit.modelo });
  }
  if (unit.tipo) {
    rows.push({ label: 'Tipo', value: unit.tipo });
  }
  return rows;
}

interface TrackingStepsProps {
  steps: string[];
  /** 0-based index of the active step; everything before it is done. */
  activeIndex: number;
  label: string;
}

/**
 * Four-step progress bar (mockup `.steps`). The active step carries
 * `aria-current="step"`, so the progress is not conveyed by colour alone.
 */
export function TrackingSteps({ steps, activeIndex, label }: TrackingStepsProps) {
  return (
    <ol aria-label={label} className="flex list-none items-start gap-0 p-0">
      {steps.map((step, index) => {
        const done = index < activeIndex;
        const current = index === activeIndex;
        return (
          <li
            key={step}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-1.5 text-center font-semibold text-[11.5px]',
              done || current ? 'text-nv-navy' : 'text-nv-navy-400',
            )}
          >
            {index > 0 && (
              <span
                aria-hidden
                className={cn(
                  'absolute top-[11px] right-1/2 left-[-50%] h-[3px]',
                  done || current ? 'bg-nv-teal' : 'bg-nv-line',
                )}
              />
            )}
            <span
              className={cn(
                'relative z-[1] flex size-6 items-center justify-center rounded-full border-2 bg-white',
                done
                  ? 'border-nv-teal bg-nv-teal text-nv-navy'
                  : current
                    ? 'border-nv-teal shadow-[0_0_0_4px_rgb(93_186_168_/_0.25)]'
                    : 'border-nv-line',
              )}
            >
              {done ? (
                <Check className="size-3.5" aria-hidden />
              ) : current ? (
                <span className="size-2 rounded-full bg-nv-teal" aria-hidden />
              ) : null}
            </span>
            {step}
          </li>
        );
      })}
    </ol>
  );
}

/** One entry of a tracking timeline; `at` is null when the step has not happened. */
export interface TimelineEntry {
  text: string;
  at: number | null;
}

/**
 * Mission timeline (mockup `.timeline` / `.tl`) shared by `C.d5` and `C.c6`.
 * Each entry carries the REAL instant of its step, so nothing is copied from the
 * mockup's hand-written hours; an entry with no instant shows no time.
 */
export function TrackingTimeline({ entries, label }: { entries: TimelineEntry[]; label: string }) {
  return (
    <ol aria-label={label} className="flex list-none flex-col gap-0 p-0">
      {entries.map((entry) => (
        <li key={entry.text} className="flex items-start gap-3 py-2">
          <span
            aria-hidden
            className="mt-1 size-3 shrink-0 rounded-full bg-nv-teal shadow-[0_0_0_3px_rgb(93_186_168_/_0.2)]"
          />
          <span className="min-w-0 flex-1 text-[13.5px] leading-5">{entry.text}</span>
          {entry.at !== null && (
            <span className="tabular shrink-0 text-nv-navy-400 text-[12.5px]">
              {formatClockTime(entry.at)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
