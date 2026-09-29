import { Ambulance, HandHeart, Layers, Siren, User, Warehouse } from 'lucide-react';
import {
  MAP_FILTER_LAYERS,
  type MapFilterCounts,
  type MapFilterLayer,
  type MapFilterState,
} from '@/features/mapa/map-filter';
import { unitPlateLabel } from '@/features/seguimiento/tracking';
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
 * The three citizen actions. "Pedir ambulancia" is live and calls the request
 * action, but it is disabled while no unit is available: with zero available
 * units the search could never be answered, so the button must not be clickable
 * and inert. "Donar suministros" opens the donation center PICKER — never a
 * pre-chosen center, the citizen selects one (list or map). It is disabled with
 * its reason only when no center declares a scarce requirement, so a back-mode
 * map (empty inventory) never offers a dead end. "Reportar zona afectada" opens
 * the citizen report dialog and is always available: reporting needs no data.
 */
function CitizenRoleActions({
  onRequest,
  availableCount,
  requestError,
  onDonate,
  donationEnabled,
  onReport,
}: {
  onRequest: () => void;
  availableCount: number;
  /** Honest reason the last request could not start; null when none. */
  requestError?: string | null;
  onDonate: () => void;
  donationEnabled: boolean;
  onReport: () => void;
}) {
  const noUnitsAvailable = availableCount === 0;
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
        onClick={onRequest}
        disabled={noUnitsAvailable}
        title={noUnitsAvailable ? 'No hay ambulancias disponibles en este momento.' : undefined}
        className={cn(ACTION_BUTTON_CLASS, 'bg-nv-red-600 text-white')}
      >
        <Ambulance className="size-5" aria-hidden />
        Pedir ambulancia
      </button>

      <button
        type="button"
        onClick={onDonate}
        disabled={!donationEnabled}
        title={
          donationEnabled ? undefined : 'Ningún centro declara insumos que necesiten donación.'
        }
        className={cn(ACTION_BUTTON_CLASS, 'bg-nv-lime text-nv-navy')}
      >
        <HandHeart className="size-5" aria-hidden />
        Donar suministros
      </button>

      <button
        type="button"
        onClick={onReport}
        className={cn(ACTION_BUTTON_CLASS, 'bg-nv-navy text-white')}
      >
        <Siren className="size-5" aria-hidden />
        Reportar zona afectada
      </button>

      {/* A blocked request must never look like a dead button: the store hands
          the page the real reason and it is shown right under the actions. */}
      {requestError && (
        <p role="status" className="text-critical text-xs">
          {requestError}
        </p>
      )}

      {availableCount === 0 && (
        <p role="status" className="text-critical text-xs">
          No hay ambulancias disponibles en este momento.
        </p>
      )}
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
        <b className="block truncate font-semibold text-[13.5px]">
          Ambulancia {unitPlateLabel(item.ambulance)}
        </b>
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

function AidCenterRow({ centro, onSelect }: { centro: CentroAyuda; onSelect: () => void }) {
  const level = centerLevel(centro);
  const meta = level ? CITIZEN_LEVEL_META[level] : null;
  // The level colours come from `CENTER_LEVEL_STYLE`, the same table the pin and
  // the legend swatch read, so the rail chip cannot pick a different red.
  const swatchStyle = level
    ? { background: CENTER_LEVEL_STYLE[level].bg, color: CENTER_LEVEL_STYLE[level].fg }
    : undefined;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-2.5 rounded-nv-md border border-nv-line p-2.5 text-left"
      >
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
          <small className="block truncate text-nv-navy-400 text-xs">
            {centerNeedLabel(centro)}
          </small>
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
      </button>
    </li>
  );
}

/** Spanish labels for the map layer toggles (the rail is a citizen surface). */
const MAP_FILTER_LABELS: Record<MapFilterLayer, string> = {
  CENTRO: 'Centros',
  AMBULANCIA: 'Ambulancias',
};

/**
 * Map layer filter control (FD-2). Two INDEPENDENT toggles, so the citizen can
 * isolate a kind ("solo ambulancias" = centers off) or combine them.
 *
 * The control only reports the choice; the page applies it to what the map
 * paints, so no filtering logic lives here. The controls are never hidden, and
 * `aria-pressed` carries each toggle's state. The count is the layer's item
 * total (not the currently painted subset), so the filter is never opaque even
 * while a layer is off.
 */
function MapFilterControl({
  filter,
  counts,
  onToggle,
}: {
  filter: MapFilterState;
  counts: MapFilterCounts;
  onToggle: (layer: MapFilterLayer) => void;
}) {
  return (
    <section
      aria-label="Capas del mapa"
      className="flex flex-col gap-2.5 rounded-nv-lg bg-white p-4 shadow-nv-card"
    >
      <p className="flex items-center gap-1.5 font-bold text-[11px] text-nv-navy-400 uppercase tracking-[0.1em]">
        <Layers className="size-3.5" aria-hidden />
        Capas del mapa
      </p>
      <div className="flex flex-wrap gap-2">
        {MAP_FILTER_LAYERS.map((layer) => {
          const visible = filter[layer];
          return (
            <button
              key={layer}
              type="button"
              aria-pressed={visible}
              aria-label={`${MAP_FILTER_LABELS[layer]} (${counts[layer]})`}
              onClick={() => onToggle(layer)}
              className={cn(
                'inline-flex items-center gap-2 rounded-nv-pill border px-3 py-1.5 font-semibold text-xs',
                visible
                  ? 'border-nv-teal bg-nv-teal/15 text-nv-navy'
                  : 'border-nv-line bg-white text-nv-navy-400',
              )}
            >
              {MAP_FILTER_LABELS[layer]}
              <span className="tabular-nums" aria-hidden>
                {counts[layer]}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface CitizenRailProps {
  nearby: NearbyAmbulance[];
  centros: CentroAyuda[];
  /** Units currently AVAILABLE; zero disables the search honestly. */
  availableCount: number;
  /** Honest reason the last request could not start; null when none. */
  requestError?: string | null;
  /** Starts the citizen request from the "Pedir ambulancia" action. */
  onRequest: () => void;
  /** Opens the donation center picker; no center is chosen for the citizen. */
  onDonate: () => void;
  /** False only when no center declares a scarce requirement to donate to. */
  donationEnabled: boolean;
  /** Opens the "report an affected zone" dialog. Always available. */
  onReport: () => void;
  /** Opens the selected center's detail (mockup `c7`). */
  onSelectCentro: (id: string) => void;
  /** Current map layer filter; owned by the page, shown by the control. */
  filter: MapFilterState;
  /** Per-layer item counts rendered next to each toggle. */
  filterCounts: MapFilterCounts;
  /** Flips one map layer; the page applies it to what the map paints. */
  onToggleFilter: (layer: MapFilterLayer) => void;
}

/** Citizen rail: role actions, then the units and centers nearest to the map. */
export function CitizenRail({
  nearby,
  centros,
  availableCount,
  requestError,
  onRequest,
  onDonate,
  donationEnabled,
  onReport,
  onSelectCentro,
  filter,
  filterCounts,
  onToggleFilter,
}: CitizenRailProps) {
  return (
    <aside
      aria-label="Panel del ciudadano"
      className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto"
    >
      <CitizenRoleActions
        onRequest={onRequest}
        availableCount={availableCount}
        requestError={requestError}
        onDonate={onDonate}
        donationEnabled={donationEnabled}
        onReport={onReport}
      />

      <MapFilterControl filter={filter} counts={filterCounts} onToggle={onToggleFilter} />

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
              <AidCenterRow
                key={centro.id}
                centro={centro}
                onSelect={() => onSelectCentro(centro.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
