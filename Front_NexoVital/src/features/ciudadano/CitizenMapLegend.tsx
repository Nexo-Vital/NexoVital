import { ChevronDown, CircleCheck, Clock, Cross, OctagonAlert, TriangleAlert } from 'lucide-react';
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
} from './citizen-view';

const LEVEL_ICON: Record<CitizenCenterLevel, typeof CircleCheck> = {
  stable: CircleCheck,
  alert: TriangleAlert,
  critical: OctagonAlert,
};

const UNIT_ICON: Record<CitizenUnitStatus, typeof CircleCheck> = {
  free: CircleCheck,
  busy: Clock,
  // MAINTENANCE maps onto the busy variant on the map, so the swatch matches it.
  maintenance: Clock,
};

/** The legend omits the maintenance row: the mockup only draws free/busy. */
const LEGEND_UNIT_ORDER = CITIZEN_UNIT_ORDER.filter((status) => status !== 'maintenance');

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
 * The card collapses to a single pill so it does not cover the map on a phone:
 * the toggle header is the only interactive part (the rest stays pointer-transparent).
 */
export function CitizenMapLegend({ counts, units }: CitizenMapLegendProps) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const unitCounts = countUnitsByStatus(units);

  return (
    <aside
      aria-label="Leyenda del mapa"
      className={cn(
        'pointer-events-none absolute bottom-4 left-4 z-[650] flex w-[228px] flex-col gap-2 rounded-nv-md bg-white/95 text-nv-navy shadow-nv-float ring-1 ring-nv-line',
        open ? 'p-4' : 'p-2',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'pointer-events-auto flex items-center gap-2 rounded-nv-md font-bold text-[11px] text-nv-navy-400 uppercase tracking-[0.1em] transition-colors hover:bg-nv-mint hover:text-nv-navy focus-visible:ring-2 focus-visible:ring-nv-teal',
          open && 'px-1 py-0.5',
        )}
      >
        Leyenda del mapa
        <ChevronDown
          aria-hidden
          className={cn('size-3.5 shrink-0 transition-transform', !open && '-rotate-90')}
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

          {/*
            Hospitals have no inventory, so they get no traffic-light state: a
            plain count read from the data (FH-3). The swatch shares the map
            pin's `.nv-hospital-shape` so the legend cannot drift from the map.
          */}
          <ul className="flex list-none flex-col gap-1.5 p-0">
            <li className="flex items-center gap-2.5 font-medium text-[13px]">
              <span
                className="nv-hospital-shape grid size-[18px] shrink-0 place-items-center"
                aria-hidden
              >
                <Cross className="size-3 -rotate-45" aria-hidden />
              </span>
              Hospitales
              <b className="tabular ml-auto font-bold">{counts.hospitals}</b>
            </li>
          </ul>

          <span className="h-px bg-nv-line" aria-hidden />

          <h4 className="font-bold text-[11px] text-nv-navy-400 uppercase tracking-[0.1em]">
            Ambulancias
          </h4>
          <ul className="flex list-none flex-col gap-1.5 p-0">
            {LEGEND_UNIT_ORDER.map((status) => {
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
