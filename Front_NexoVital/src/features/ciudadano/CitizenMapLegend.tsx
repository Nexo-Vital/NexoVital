import {
  ChevronDown,
  CircleCheck,
  Clock,
  OctagonAlert,
  PowerOff,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Ambulancia } from '@/types/domain';
import {
  CENTER_LEVEL_STYLE,
  CITIZEN_LEVEL_META,
  CITIZEN_LEVEL_ORDER,
  CITIZEN_UNIT_META,
  CITIZEN_UNIT_ORDER,
  type CitizenCenterCounts,
  type CitizenCenterLevel,
  type CitizenUnitStatus,
  countUnitsByStatus,
  NOT_DECLARED_CENTER_STYLE,
  UNIT_NO_SIGNAL_LABEL,
  UNIT_NO_SIGNAL_MARKER_CLASS,
  unitHasLostSignal,
} from './citizen-view';

const LEVEL_ICON: Record<CitizenCenterLevel, typeof CircleCheck> = {
  complete: CircleCheck,
  stable: CircleCheck,
  alert: TriangleAlert,
  critical: OctagonAlert,
};

const UNIT_ICON: Record<CitizenUnitStatus, typeof CircleCheck> = {
  free: CircleCheck,
  busy: Clock,
  // An out-of-service unit is drawn on the busy circle; the badge icon is what
  // tells the two apart, here and on the map pin.
  maintenance: PowerOff,
};

interface CitizenMapLegendProps {
  counts: CitizenCenterCounts;
  units: Ambulancia[];
}

/**
 * Live legend for the citizen map. Unlike the CRUE legend (static groups), every
 * row carries the current count. The centre swatches read `CENTER_LEVEL_STYLE` —
 * the same table the map pins use — and the unit swatches reuse the pin tokens,
 * so the legend cannot drift from the map.
 *
 * A unit without signal is drawn gray on the map whatever its state, so it is
 * counted in its own "Sin señal" row and NOT in the other three: each row counts
 * the pins drawn that way.
 *
 * "Fuera de servicio" counts the units that cannot take a request for a reason
 * other than being busy: a disconnected driver (EP-04.F2.US1) or maintenance.
 * The four rows always add up to the fleet.
 *
 * It lives in the shell sidebar, outside the map, and its header collapses it.
 */
export function CitizenMapLegend({ counts, units }: CitizenMapLegendProps) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const unitsWithSignal = units.filter((unit) => !unitHasLostSignal(unit));
  const unitCounts = countUnitsByStatus(unitsWithSignal);
  const noSignalCount = units.length - unitsWithSignal.length;

  return (
    <aside
      aria-label="Leyenda del mapa"
      className="flex w-full flex-col gap-2 rounded-nv-md border border-nv-line bg-white p-3 text-nv-navy"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 rounded-nv-md px-1 py-0.5 font-bold text-[11px] text-nv-navy-400 uppercase tracking-[0.1em] transition-colors hover:bg-nv-mint hover:text-nv-navy focus-visible:ring-2 focus-visible:ring-nv-teal"
      >
        Leyenda del mapa
        <ChevronDown
          aria-hidden
          className={cn('ml-auto size-3.5 shrink-0 transition-transform', !open && '-rotate-90')}
        />
      </button>

      {open && (
        <div id={bodyId} className="flex flex-col gap-2">
          <h4 className="font-bold text-[11px] text-nv-navy-400 uppercase tracking-[0.1em]">
            Centros de acopio
          </h4>
          <ul className="flex list-none flex-col gap-1.5 p-0">
            {CITIZEN_LEVEL_ORDER.map((level) => {
              const style = CENTER_LEVEL_STYLE[level];
              const Icon = LEVEL_ICON[level];
              return (
                <li key={level} className="flex items-center gap-2.5 font-medium text-[13px]">
                  <span
                    className="flex size-[18px] shrink-0 items-center justify-center rounded-[6px]"
                    style={{ background: style.bg, color: style.fg }}
                    aria-hidden
                  >
                    <Icon className="size-3" aria-hidden />
                  </span>
                  {CITIZEN_LEVEL_META[level].label}
                  <b className="tabular ml-auto font-bold">{counts[level]}</b>
                </li>
              );
            })}
            <li className="flex items-center gap-2.5 font-medium text-[13px]">
              <span
                className="size-[18px] shrink-0 rounded-[6px]"
                style={{ background: NOT_DECLARED_CENTER_STYLE.bg }}
                aria-hidden
              />
              Sin declarar
              <b className="tabular ml-auto font-bold">{counts.notDeclared}</b>
            </li>
          </ul>

          <span className="h-px bg-nv-line" aria-hidden />

          <h4 className="font-bold text-[11px] text-nv-navy-400 uppercase tracking-[0.1em]">
            Ambulancias
          </h4>
          <ul className="flex list-none flex-col gap-1.5 p-0">
            {CITIZEN_UNIT_ORDER.map((status) => {
              const meta = CITIZEN_UNIT_META[status];
              const Icon = UNIT_ICON[status];
              return (
                <li key={status} className="flex items-center gap-2.5 font-medium text-[13px]">
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full',
                      meta.markerClass,
                    )}
                  >
                    <Icon className="size-[11px]" aria-hidden />
                  </span>
                  {meta.label}
                  <b className="tabular ml-auto font-bold">{unitCounts[status]}</b>
                </li>
              );
            })}
            <li className="flex items-center gap-2.5 font-medium text-[13px]">
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full',
                  UNIT_NO_SIGNAL_MARKER_CLASS,
                )}
              >
                <WifiOff className="size-[11px]" aria-hidden />
              </span>
              {UNIT_NO_SIGNAL_LABEL}
              <b className="tabular ml-auto font-bold">{noSignalCount}</b>
            </li>
          </ul>

          <span className="h-px bg-nv-line" aria-hidden />

          <div className="flex items-center gap-2.5 font-medium text-[13px]">
            <span
              className="mx-0.5 size-3.5 shrink-0 rounded-full border-[3px] border-white bg-nv-navy-600 shadow-[0_0_0_4px_rgb(61_111_158_/_0.2)]"
              aria-hidden
            />
            Tú
          </div>
        </div>
      )}
    </aside>
  );
}
