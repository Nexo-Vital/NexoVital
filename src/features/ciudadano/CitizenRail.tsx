import { Ambulance, HandHeart, User, Warehouse } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CentroAyuda } from '@/types/domain';
import {
  CENTER_LEVEL_STYLE,
  CITIZEN_LEVEL_META,
  CITIZEN_UNIT_META,
  centerLevel,
  centerNeedLabel,
  type NearbyAmbulance,
} from './citizen-view';

const ACTION_BUTTON_CLASS =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md px-5 font-semibold text-sm disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The two citizen actions the mockup shows. Neither flow exists in this build,
 * so both are rendered explicitly disabled with a visible note: nothing on the
 * screen can be clicked and then do nothing, and no fake route is wired up.
 */
function CitizenRoleActions() {
  return (
    <section
      aria-label="Acciones de tu rol"
      className="flex flex-col gap-2.5 rounded-nv-lg bg-white p-4 shadow-nv-card"
    >
      <p className="flex items-center gap-1.5 font-bold text-[11px] text-nv-navy-400 uppercase tracking-[0.1em]">
        <User className="size-3.5" aria-hidden />
        Acciones de tu rol · Ciudadano
      </p>

      <button
        type="button"
        disabled
        title="Próximamente"
        className={cn(ACTION_BUTTON_CLASS, 'bg-nv-red-600 text-white')}
      >
        <Ambulance className="size-5" aria-hidden />
        Pedir ambulancia
      </button>

      <button
        type="button"
        disabled
        title="Próximamente"
        className={cn(ACTION_BUTTON_CLASS, 'bg-nv-lime text-nv-navy')}
      >
        <HandHeart className="size-5" aria-hidden />
        Donar suministros
      </button>

      <p className="text-nv-navy-400 text-xs">
        Próximamente: estas acciones se habilitarán cuando el flujo esté publicado.
      </p>
    </section>
  );
}

function NearbyAmbulanceRow({ item }: { item: NearbyAmbulance }) {
  const meta = CITIZEN_UNIT_META[item.status];
  return (
    <li className="flex items-center gap-2.5 rounded-nv-md bg-nv-mint p-2.5">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          meta.markerClass,
        )}
      >
        <Ambulance className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate font-semibold text-[13.5px]">Ambulancia {item.ambulance.id}</b>
        <small className="block truncate text-nv-navy-400 text-xs">{item.detail}</small>
      </span>
      <span
        className={cn('shrink-0 rounded-nv-pill px-2.5 py-1 font-semibold text-xs', meta.chipClass)}
      >
        {meta.label}
      </span>
    </li>
  );
}

function AidCenterRow({ centro }: { centro: CentroAyuda }) {
  const level = centerLevel(centro);
  const meta = level ? CITIZEN_LEVEL_META[level] : null;
  // The level colours come from `CENTER_LEVEL_STYLE`, the same table the pin and
  // the legend swatch read, so the rail chip cannot pick a different red.
  const swatchStyle = level
    ? { background: CENTER_LEVEL_STYLE[level].bg, color: CENTER_LEVEL_STYLE[level].fg }
    : undefined;
  return (
    <li className="flex items-center gap-2.5 rounded-nv-md border border-nv-line p-2.5">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-nv-md',
          !swatchStyle && 'bg-idle/15 text-idle ring-1 ring-idle/40',
        )}
        style={swatchStyle}
      >
        <Warehouse className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate font-semibold text-[13.5px]">{centro.nombre}</b>
        <small className="block truncate text-nv-navy-400 text-xs">{centerNeedLabel(centro)}</small>
      </span>
      <span
        className={cn(
          'shrink-0 rounded-nv-pill px-2.5 py-1 font-semibold text-xs',
          !swatchStyle && 'bg-idle/15 text-idle ring-1 ring-idle/40',
        )}
        style={swatchStyle}
      >
        {meta ? meta.label : 'Sin declarar'}
      </span>
    </li>
  );
}

interface CitizenRailProps {
  nearby: NearbyAmbulance[];
  centros: CentroAyuda[];
}

/** Citizen rail: role actions, then the units and centers nearest to the map. */
export function CitizenRail({ nearby, centros }: CitizenRailProps) {
  return (
    <aside
      aria-label="Panel del ciudadano"
      className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto"
    >
      <CitizenRoleActions />

      <section
        aria-label="Ambulancias cerca de ti"
        className="flex flex-col gap-3 rounded-nv-lg bg-white p-4 shadow-nv-card"
      >
        <h4 className="flex items-center gap-2 font-bold text-sm">
          <Ambulance className="size-4 text-nv-navy" aria-hidden />
          Ambulancias cerca de ti
        </h4>
        {nearby.length === 0 ? (
          <p className="text-nv-navy-400 text-sm">No hay ambulancias para mostrar.</p>
        ) : (
          <ul className="flex list-none flex-col gap-2.5 p-0">
            {nearby.map((item) => (
              <NearbyAmbulanceRow key={item.ambulance.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      <section
        aria-label="Centros de acopio"
        className="flex flex-col gap-3 rounded-nv-lg bg-white p-4 shadow-nv-card"
      >
        <h4 className="flex items-center gap-2 font-bold text-sm">
          <Warehouse className="size-4 text-nv-navy" aria-hidden />
          Centros de acopio
        </h4>
        {centros.length === 0 ? (
          <p className="text-nv-navy-400 text-sm">No hay centros de acopio para mostrar.</p>
        ) : (
          <ul className="flex list-none flex-col gap-2.5 p-0">
            {centros.map((centro) => (
              <AidCenterRow key={centro.id} centro={centro} />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
