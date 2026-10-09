import { ArrowLeft, Info, MapPin, Minus, Package, Plus, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nvButton } from '@/components/ui/button';
import {
  CENTER_LEVEL_STYLE,
  citizenCenterLevel,
  NOT_DECLARED_CENTER_STYLE,
} from '@/features/ciudadano/citizen-view';
import { LevelChip } from '@/features/donaciones/DonationFlow';
import { barPercent } from '@/features/donaciones/donation';
import { formatCoordenadas, reverseGeocode } from '@/features/geocodificacion/geocoding-api';
import { centroSemaforo } from '@/features/recursos/traffic-light';
import type { CentroAyuda, InventarioItem, TrafficLight } from '@/types/domain';

function levelStyle(level: TrafficLight) {
  const citizen = citizenCenterLevel(level);
  return citizen ? CENTER_LEVEL_STYLE[citizen] : NOT_DECLARED_CENTER_STYLE;
}

/**
 * Readable address of the center. The backend stores only the coordinates (the
 * team's decision for the affected-zone report holds here too), so the address
 * is looked up for display; while it loads, and whenever the geocoder fails, the
 * coordinates are shown instead of an invented street.
 */
function useCenterAddress(lat: number, lng: number): string {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setAddress(null);
    reverseGeocode({ lat, lng })
      .then((found) => {
        if (active && found) {
          setAddress(`Cerca de ${found}`);
        }
      })
      .catch(() => {
        // The coordinates stay on screen: a geocoder failure is never an error here.
      });
    return () => {
      active = false;
    };
  }, [lat, lng]);
  return address ?? formatCoordenadas({ lat, lng });
}

/** One supply row: name, level, bar, quantity and the "Retirar" action. */
function SupplyRow({
  item,
  onWithdraw,
}: {
  item: InventarioItem;
  onWithdraw: (item: InventarioItem) => void;
}) {
  const style = levelStyle(item.semaforo);
  const percent = barPercent(item.disponible, item.requerido);
  const empty = item.disponible <= 0;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 font-semibold text-[13.5px]">
        <span className="truncate">{item.nombre}</span>
        <span className="flex-1" />
        <LevelChip level={item.semaforo} />
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-nv-pill bg-nv-line" aria-hidden>
        <span className="h-full" style={{ width: `${percent}%`, background: style.bg }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="tabular text-nv-navy-400 text-xs">
          {item.disponible} de {item.requerido}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onWithdraw(item)}
          disabled={empty}
          title={empty ? 'No hay unidades para retirar.' : undefined}
          aria-label={`Retirar unidades de ${item.nombre}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-nv-md border-[1.5px] border-nv-line bg-white px-2.5 font-semibold text-nv-navy text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Minus className="size-3.5" aria-hidden />
          Retirar
        </button>
      </div>
    </li>
  );
}

interface MyCenterRailProps {
  /** The administrator's center with its LIVE inventory. */
  centro: CentroAyuda;
  /** Opens the "add a supply" dialog. */
  onAddSupply: () => void;
  /** Opens the "withdraw units" dialog for one supply. */
  onWithdraw: (item: InventarioItem) => void;
  onBackToMap: () => void;
}

/**
 * "Administrar mi centro" rail of the help-center administrator (EP-03.F1.US1):
 * the center's name, where it is and each supply with what it has against the
 * maximum it needs. From here the administrator declares a new supply or
 * withdraws units of one that left the center.
 *
 * The inventory is the same shared state the public map reads, so a donation
 * made by a citizen shows up here on its own.
 */
export function MyCenterRail({ centro, onAddSupply, onWithdraw, onBackToMap }: MyCenterRailProps) {
  const level = centroSemaforo(centro);
  const style = levelStyle(level);
  const address = useCenterAddress(centro.ubicacion.lat, centro.ubicacion.lng);
  const totalUnits = centro.items.reduce((sum, item) => sum + item.disponible, 0);

  return (
    <aside
      aria-label="Panel de mi centro"
      className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto"
    >
      <section className="flex flex-col gap-3.5 rounded-nv-lg bg-white p-4 shadow-nv-card">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBackToMap}
            aria-label="Volver al panel"
            className="flex size-9 shrink-0 items-center justify-center rounded-nv-md text-nv-navy-400 transition-colors hover:bg-nv-mint hover:text-nv-navy focus-visible:outline-2 focus-visible:outline-nv-teal focus-visible:outline-offset-2"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </button>
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-nv-md"
            style={{ background: style.bg, color: style.fg }}
          >
            <Warehouse className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <h2 className="truncate font-semibold text-[17px] leading-[22px]">{centro.nombre}</h2>
            <p className="text-nv-navy-400 text-xs">Tu centro</p>
          </span>
        </div>

        <p className="flex items-start gap-2 text-nv-navy text-xs">
          <MapPin className="mt-px size-4 shrink-0 text-nv-navy-400" aria-hidden />
          <span data-testid="my-center-address">{address}</span>
        </p>

        <div className="flex items-center gap-2.5">
          <LevelChip level={level} />
          <span className="text-nv-navy-400 text-xs">
            {centro.items.length === 1 ? '1 insumo' : `${centro.items.length} insumos`} ·{' '}
            {totalUnits === 1 ? '1 unidad' : `${totalUnits} unidades`} en total
          </span>
        </div>

        <h4 className="flex items-center gap-2 font-bold text-sm">
          <Package className="size-4 text-nv-navy" aria-hidden />
          Insumos del centro
        </h4>
        {centro.items.length === 0 ? (
          <p className="text-nv-navy-400 text-sm">
            Tu centro no tiene ni necesita nada por ahora, por eso aparece como completo. Agrega un
            insumo cuando quieras declararlo.
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-3.5 p-0">
            {centro.items.map((item) => (
              <SupplyRow key={item.id} item={item} onWithdraw={onWithdraw} />
            ))}
          </ul>
        )}

        <div className="flex items-start gap-2 rounded-nv-md bg-nv-mint p-2.5 text-nv-navy text-xs">
          <Info className="mt-px size-4 shrink-0 text-nv-navy-600" aria-hidden />
          <span>
            Cada insumo muestra lo que tienes frente al máximo que necesita el centro. Usa "Retirar"
            cuando salgan unidades; las donaciones se suman solas.
          </span>
        </div>
      </section>

      <button type="button" onClick={onAddSupply} className={nvButton({ tone: 'supply' })}>
        <Plus className="size-5" aria-hidden />
        Agregar insumo
      </button>
    </aside>
  );
}
