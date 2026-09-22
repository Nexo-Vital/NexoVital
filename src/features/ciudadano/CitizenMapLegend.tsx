import { CircleAlert, CircleCheck, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Ambulancia } from '@/types/domain';
import {
  CITIZEN_LEVEL_META,
  CITIZEN_LEVEL_ORDER,
  CITIZEN_UNIT_META,
  CITIZEN_UNIT_ORDER,
  type CitizenCenterCounts,
  type CitizenUnitStatus,
  countUnitsByStatus,
} from './citizen-view';

const UNIT_ICON: Record<CitizenUnitStatus, typeof CircleCheck> = {
  free: CircleCheck,
  busy: Clock,
  maintenance: CircleAlert,
};

interface CitizenMapLegendProps {
  counts: CitizenCenterCounts;
  units: Ambulancia[];
}

/**
 * Live legend for the citizen map. Unlike the CRUE legend (static groups), every
 * row carries the current count, and the center colors reuse the same semantic
 * tokens the shared markers draw with, so the legend cannot drift from the map.
 */
export function CitizenMapLegend({ counts, units }: CitizenMapLegendProps) {
  const unitCounts = countUnitsByStatus(units);

  return (
    <aside
      aria-label="Leyenda del mapa"
      className="pointer-events-none absolute bottom-4 left-4 z-[650] flex w-[228px] flex-col gap-2 rounded-nv-md bg-white/95 p-4 text-nv-navy shadow-nv-float ring-1 ring-nv-line"
    >
      <h4 className="font-bold text-[11px] text-nv-navy-400 uppercase tracking-[0.1em]">
        Centros de acopio
      </h4>
      <ul className="flex list-none flex-col gap-1.5 p-0">
        {CITIZEN_LEVEL_ORDER.map((level) => (
          <li key={level} className="flex items-center gap-2.5 font-medium text-[13px]">
            <span
              className={cn('size-3 shrink-0 rounded-full', CITIZEN_LEVEL_META[level].swatchClass)}
              aria-hidden
            />
            {CITIZEN_LEVEL_META[level].label}
            <b className="tabular ml-auto font-bold">{counts[level]}</b>
          </li>
        ))}
        <li className="flex items-center gap-2.5 font-medium text-[13px]">
          <span className="size-3 shrink-0 rounded-full bg-idle" aria-hidden />
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
                <Icon className="size-3" aria-hidden />
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
    </aside>
  );
}
