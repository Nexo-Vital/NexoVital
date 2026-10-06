import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  HandHeart,
  Info,
  Map as MapIcon,
  Minus,
  Package,
  Plus,
  Warehouse,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  CENTER_LEVEL_STYLE,
  CITIZEN_LEVEL_META,
  centerAlerts,
  citizenCenterLevel,
  NOT_DECLARED_CENTER_STYLE,
} from '@/features/ciudadano/citizen-view';
import { centroSemaforo, trafficLight } from '@/features/recursos/traffic-light';
import { distanceKm } from '@/lib/geo';
import { cn } from '@/lib/utils';
import type { CentroAyuda, InventarioItem, TrafficLight } from '@/types/domain';
import {
  barPercent,
  type DonationRecord,
  donableItems,
  formatDistanceTo,
  levelWord,
  previewDonation,
  previewMessage,
  scarceNote,
} from './donation';

/** The mockup's c8 stepper starts at 40; the user adjusts it with −/+. */
const DEFAULT_AMOUNT = 40;

/**
 * Pill carrying a traffic light as text. Colours come from `CENTER_LEVEL_STYLE`
 * (the same table the map pin and the legend read), so a chip can never show a
 * second red. `NOT_DECLARED` gets the neutral style.
 */
export function LevelChip({ level }: { level: TrafficLight }) {
  const citizen = citizenCenterLevel(level);
  const style = citizen ? CENTER_LEVEL_STYLE[citizen] : NOT_DECLARED_CENTER_STYLE;
  const label = citizen ? CITIZEN_LEVEL_META[citizen].label : 'Sin declarar';
  return (
    <span
      className="shrink-0 rounded-nv-pill px-2.5 py-1 font-semibold text-xs"
      style={{ background: style.bg, color: style.fg }}
    >
      {label}
    </span>
  );
}

function levelStyle(level: TrafficLight) {
  const citizen = citizenCenterLevel(level);
  return citizen ? CENTER_LEVEL_STYLE[citizen] : NOT_DECLARED_CENTER_STYLE;
}

/** One inventory row: name, optional "+amount" mark, level chip and bar. */
function InventoryRow({ item, donated }: { item: InventarioItem; donated: DonationRecord | null }) {
  const style = levelStyle(item.semaforo);
  const after = barPercent(item.disponible, item.requerido);
  const beforeAvailable = donated ? item.disponible - donated.amount : item.disponible;
  const before = donated ? barPercent(beforeAvailable, item.requerido) : after;
  const beforeStyle = levelStyle(trafficLight(beforeAvailable, item.requerido));
  const quantity = item.unidad
    ? `${item.disponible} de ${item.requerido} ${item.unidad}`
    : `${item.disponible} de ${item.requerido}`;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 font-semibold text-[13.5px]">
        <span className="truncate">{item.nombre}</span>
        {donated && (
          <span className="shrink-0 rounded-nv-pill bg-nv-lime px-2 py-0.5 font-bold text-[11px] text-nv-navy">
            +{donated.amount}
          </span>
        )}
        <span className="flex-1" />
        <LevelChip level={item.semaforo} />
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-nv-pill bg-nv-line" aria-hidden>
        {donated ? (
          <>
            <span className="h-full" style={{ width: `${before}%`, background: beforeStyle.bg }} />
            <span
              className="h-full bg-nv-lime"
              style={{ width: `${Math.max(0, after - before)}%` }}
            />
          </>
        ) : (
          <span className="h-full" style={{ width: `${after}%`, background: style.bg }} />
        )}
      </div>
      <span className="tabular text-nv-navy-400 text-xs">{quantity}</span>
    </li>
  );
}

interface CenterDetailRailProps {
  centro: CentroAyuda;
  /** Origin used to compute the "a X de ti" line. */
  origin: { lat: number; lng: number };
  /** The donation that just happened, when this center shows its c9 state. */
  lastDonation: DonationRecord | null;
  onDonate: () => void;
  onBackToMap: () => void;
}

/**
 * `C.c7`/`C.c9` rail: the selected center's card and its inventory, plus the
 * donation actions. It reads the center's REAL data: the level is `centroSemaforo`
 * (the worst item), the distance is computed, and the "what it needs most" line
 * follows the inventory, so after a donation it names the new scarce item.
 */
export function CenterDetailRail({
  centro,
  origin,
  lastDonation,
  onDonate,
  onBackToMap,
}: CenterDetailRailProps) {
  const level = centroSemaforo(centro);
  const style = levelStyle(level);
  const distance = formatDistanceTo(distanceKm(origin, centro.ubicacion));
  const secondary = centro.direccion ? `${centro.direccion} · ${distance}` : distance;
  const canDonate = donableItems(centro).length > 0;
  const donateBlockedReason =
    centro.items.length === 0
      ? 'Este centro no declara insumos todavía.'
      : 'Este centro ya tiene todo lo que necesita.';
  const alerts = centerAlerts(centro);
  const [worstAlert] = alerts;
  const donatedItem = lastDonation
    ? (centro.items.find((item) => item.id === lastDonation.itemId) ?? null)
    : null;

  return (
    <aside
      aria-label="Panel del ciudadano"
      className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto"
    >
      <section className="flex flex-col gap-3.5 rounded-nv-lg bg-white p-4 shadow-nv-card">
        <div className="flex items-center gap-2.5">
          {/*
            Always-present exit (C.c7 and C.c9): choosing a center must never
            trap the citizen. It reuses `onBackToMap`, the same callback the
            post-donation "Volver al mapa" bottom button calls.
          */}
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
            <p className="truncate text-nv-navy-400 text-xs">{secondary}</p>
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <LevelChip level={level} />
          <span className="text-nv-navy-400 text-xs">
            {lastDonation
              ? `Antes estaba en ${levelWord(lastDonation.beforeCenterLevel)}`
              : 'Estado del centro'}
          </span>
        </div>

        {/*
          Active shortage alert (EP-03.F1.US5): the resource the center is most
          short of and how many units are still missing. It is NOT the traffic
          light — the light says how far the center is from what it needs, this
          names the resource and the amount — so it gets its own red block. A
          center missing nothing renders nothing here, and the block goes away
          on its own when a donation completes the need.
        */}
        {worstAlert && (
          <div
            data-testid="centro-alerta-escasez"
            className="flex items-start gap-2 rounded-nv-md bg-nv-red-600/10 p-2.5 text-nv-navy text-xs"
          >
            <AlertTriangle className="mt-px size-4 shrink-0 text-nv-red-600" aria-hidden />
            <span>
              <b className="text-nv-red-600">Alerta de escasez:</b> faltan{' '}
              <b>{worstAlert.faltante}</b> de {worstAlert.nombre.toLowerCase()} (tiene{' '}
              {worstAlert.disponible} de {worstAlert.requerido}).
              {alerts.length > 1 && <> Hay {alerts.length} recursos en escasez en este centro.</>}
            </span>
          </div>
        )}

        <h4 className="flex items-center gap-2 font-bold text-sm">
          <Package className="size-4 text-nv-navy" aria-hidden />
          Insumos del centro
        </h4>
        {centro.items.length === 0 ? (
          <p className="text-nv-navy-400 text-sm">Este centro no declara insumos todavía.</p>
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {centro.items.map((item) => (
              <InventoryRow
                key={item.id}
                item={item}
                donated={donatedItem?.id === item.id ? lastDonation : null}
              />
            ))}
          </ul>
        )}

        <div className="flex items-start gap-2 rounded-nv-md bg-nv-mint p-2.5 text-nv-navy text-xs">
          <Info className="mt-px size-4 shrink-0 text-nv-navy-600" aria-hidden />
          <span>
            El color del centro es el de su insumo más escaso.{' '}
            {scarceNote(centro, lastDonation ? 'now' : 'today')}
          </span>
        </div>
      </section>

      {/* One generic action: the dialog lists every item with a gap, so the
          button never names a single item (it used to hide the other needs). */}
      <button
        type="button"
        onClick={onDonate}
        disabled={!canDonate}
        title={canDonate ? undefined : donateBlockedReason}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-lime px-5 font-semibold text-nv-navy text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Warehouse className="size-5" aria-hidden />
        Donar a este centro
      </button>
      {lastDonation && (
        <button
          type="button"
          onClick={onBackToMap}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm"
        >
          <MapIcon className="size-5" aria-hidden />
          Volver al mapa
        </button>
      )}
    </aside>
  );
}

interface DonationCenterPickerProps {
  /** Centers that can receive a donation, worst first (from `donableCenters`). */
  centros: CentroAyuda[];
  /** Opens the picked center's c7 detail; the map tap calls the same handler. */
  onSelect: (id: string) => void;
  /** Leaves the picker without donating: no center is ever selected for you. */
  onCancel: () => void;
}

/** How many alerts a picker row lists before folding the rest into a count. */
const PICKER_ALERTS_SHOWN = 3;

/**
 * Center picker for the donation flow, and the donor's view of the pending
 * donation alerts (EP-03.F3.US4).
 *
 * "Donar suministros" must NOT choose a center for the citizen, so this lists
 * the centers that actually need a donation (`donableCenters`, most urgent
 * first) and waits. Each row shows the center with EVERY resource it is missing
 * and how many units (`centerAlerts`), which is what lets the donor decide whom
 * to help. Picking one here — or tapping it on the map, which calls the same
 * `onSelect` — opens the c7 detail; without a pick there is no donation. The
 * palette is the mockup's fixed one (only `nv-*` tokens and an explicit white),
 * so the panel reads the same in either theme.
 */
export function DonationCenterPicker({ centros, onSelect, onCancel }: DonationCenterPickerProps) {
  return (
    <aside
      aria-label="Elegir centro de donación"
      className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto"
    >
      <section className="flex flex-col gap-3 rounded-nv-lg bg-white p-4 shadow-nv-card">
        <h4 className="flex items-center gap-2 font-bold text-sm">
          <Warehouse className="size-4 text-nv-navy" aria-hidden />
          Centros que necesitan ayuda
        </h4>
        <p className="text-nv-navy-400 text-sm">
          Cada centro muestra lo que le falta. Elige a cuál vas a llevar tu donación; también puedes
          tocar uno en el mapa.
        </p>
        {centros.length === 0 ? (
          <p className="text-nv-navy-400 text-sm">
            Ningún centro tiene alertas de donación pendientes.
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-2.5 p-0">
            {centros.map((centro) => {
              const alerts = centerAlerts(centro);
              const hidden = alerts.length - PICKER_ALERTS_SHOWN;
              return (
                <li key={centro.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(centro.id)}
                    aria-label={`Donar a ${centro.nombre}`}
                    className="flex w-full flex-col gap-2 rounded-nv-md border border-nv-line bg-white p-2.5 text-left"
                  >
                    <span className="flex w-full items-center gap-2.5">
                      <b className="min-w-0 flex-1 truncate font-semibold text-[13.5px] text-nv-navy">
                        {centro.nombre}
                      </b>
                      <LevelChip level={centroSemaforo(centro)} />
                    </span>
                    <ul
                      aria-label={`Lo que le falta a ${centro.nombre}`}
                      className="flex w-full list-none flex-col gap-1 p-0"
                    >
                      {alerts.slice(0, PICKER_ALERTS_SHOWN).map((alert) => (
                        <li
                          key={alert.itemId}
                          className="flex items-baseline gap-2 text-nv-navy-400 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate">{alert.nombre}</span>
                          <span className="tabular shrink-0">
                            faltan <b className="text-nv-navy">{alert.faltante}</b>
                          </span>
                        </li>
                      ))}
                      {hidden > 0 && (
                        <li className="text-nv-navy-400 text-xs">
                          y {hidden} {hidden === 1 ? 'recurso más' : 'recursos más'}
                        </li>
                      )}
                    </ul>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm"
        >
          <X className="size-5" aria-hidden />
          Cancelar
        </button>
      </section>
    </aside>
  );
}

interface DonationDialogProps {
  centro: CentroAyuda;
  onConfirm: (itemId: string, amount: number) => void;
  onClose: () => void;
}

/**
 * `C.c8` donation dialog: pick a SCARCE item (declared and not stable, most
 * critical first), set the amount with a stepper, and read the prospective
 * result before confirming. It is a real modal (the app's accessible dialog
 * primitive), so the page behind it is inert and Escape/outside-click close it.
 * The preview numbers and the outcome line are computed from the same
 * `traffic-light` thresholds the rest of the app uses.
 *
 * The palette is FIXED to the mockup: the content overrides the primitive's
 * semantic (`bg-card`, `text-card-foreground`, `border-border`) and the scrim
 * overrides `bg-background` with `nv-*`/white tokens, so the modal is a white
 * card with navy text in EITHER theme, never a dark card on the light citizen
 * screen.
 */
export function DonationDialog({ centro, onConfirm, onClose }: DonationDialogProps) {
  const options = donableItems(centro);
  const [itemId, setItemId] = useState(() => options[0]?.id ?? '');
  const item = options.find((entry) => entry.id === itemId) ?? options[0] ?? null;
  const maxAmount = item ? Math.max(1, item.requerido - item.disponible) : 1;
  // `null` while the field is being cleared to type a new number; the preview
  // then falls back to 1 and the field is restored on blur.
  const [rawAmount, setRawAmount] = useState<number | null>(DEFAULT_AMOUNT);
  const amount = Math.min(Math.max(1, rawAmount ?? 1), maxAmount);
  const preview = item ? previewDonation(centro, item.id, amount) : null;

  const selectItem = (nextId: string) => {
    setItemId(nextId);
    const next = options.find((entry) => entry.id === nextId);
    const nextMax = next ? Math.max(1, next.requerido - next.disponible) : 1;
    setRawAmount((previous) => Math.min(Math.max(1, previous ?? 1), nextMax));
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent
        showClose={false}
        overlayClassName="bg-nv-navy/45 backdrop-blur-none"
        className="flex w-[min(92vw,480px)] max-w-[480px] flex-col gap-[18px] rounded-[20px] border-nv-line bg-white p-8 text-nv-navy"
      >
        <DialogTitle className="sr-only">Donar a {centro.nombre}</DialogTitle>
        <DialogDescription className="sr-only">
          Elige el insumo y la cantidad que vas a llevar al centro.
        </DialogDescription>

        <div>
          <h3 className="font-semibold text-2xl leading-8 tracking-[-0.3px]">
            Donar a {centro.nombre}
          </h3>
          <p className="mt-1 text-nv-navy-400 text-sm">
            Elige el insumo y la cantidad que vas a llevar al centro.
          </p>
        </div>

        <fieldset className="m-0 border-0 p-0">
          <legend className="font-semibold text-nv-navy text-sm">Insumo</legend>
          <div className="mt-2 flex flex-col gap-2">
            {options.length === 0 ? (
              <p className="text-nv-navy-400 text-sm">Este centro no declara insumos todavía.</p>
            ) : (
              options.map((option) => (
                <label
                  key={option.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-nv-md border-[1.5px] bg-white px-3.5 py-3 font-medium text-sm',
                    option.id === item?.id
                      ? 'border-nv-teal shadow-[0_0_0_3px_rgba(93,186,168,0.2)]'
                      : 'border-nv-line',
                  )}
                >
                  <input
                    type="radio"
                    name="donation-item"
                    value={option.id}
                    checked={option.id === item?.id}
                    onChange={() => selectItem(option.id)}
                    className="size-4 accent-nv-teal"
                  />
                  <span className="flex-1 font-medium text-sm">{option.nombre}</span>
                  <LevelChip level={option.semaforo} />
                </label>
              ))
            )}
          </div>
        </fieldset>

        <div>
          <span className="font-semibold text-nv-navy text-sm">Cantidad</span>
          <div className="mt-2 flex h-[52px] items-center overflow-hidden rounded-nv-md border-[1.5px] border-nv-line">
            <button
              type="button"
              aria-label="Quitar uno"
              onClick={() => setRawAmount(amount - 1)}
              disabled={amount <= 1}
              className="flex h-full w-14 items-center justify-center bg-nv-mint text-nv-navy disabled:opacity-40"
            >
              <Minus className="size-5" aria-hidden />
            </button>
            <label className="tabular flex flex-1 items-center justify-center gap-1.5 font-bold text-xl">
              <input
                type="text"
                inputMode="numeric"
                aria-label="Cantidad a donar"
                value={rawAmount === null ? '' : amount}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '');
                  setRawAmount(digits === '' ? null : Number(digits));
                }}
                onBlur={() => setRawAmount(amount)}
                onFocus={(event) => event.target.select()}
                className="w-16 rounded-nv-sm border-0 bg-transparent text-center font-bold text-xl outline-none focus:bg-nv-mint"
              />
              {(item?.unitDetail ?? item?.unidad) && (
                <small className="font-medium text-nv-navy-400 text-sm">
                  {item.unitDetail ?? item.unidad}
                </small>
              )}
            </label>
            <button
              type="button"
              aria-label="Agregar uno"
              onClick={() => setRawAmount(amount + 1)}
              disabled={amount >= maxAmount}
              className="flex h-full w-14 items-center justify-center bg-nv-mint text-nv-navy disabled:opacity-40"
            >
              <Plus className="size-5" aria-hidden />
            </button>
          </div>
          <p className="mt-1.5 text-nv-navy-400 text-xs">
            Escribe la cantidad o ajústala con − y +. Máximo {maxAmount}: lo que le falta al centro.
          </p>
        </div>

        {preview && item && (
          <div className="flex flex-col gap-2.5 rounded-nv-md bg-nv-mint p-3.5">
            <span className="font-bold text-nv-navy-400 text-xs">
              Así queda el centro con tu donación
            </span>
            <div className="flex items-center gap-2 font-semibold text-[13.5px]">
              <span className="truncate">{item.nombre}</span>
              <small className="tabular ml-auto font-medium text-nv-navy-400 text-xs">
                {preview.before} → {preview.after} de {item.requerido}
              </small>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-nv-pill bg-white/60" aria-hidden>
              <span
                className="h-full"
                style={{
                  width: `${preview.beforePercent}%`,
                  background: levelStyle(preview.beforeLight).bg,
                }}
              />
              <span
                className="h-full bg-nv-lime"
                style={{ width: `${Math.max(0, preview.afterPercent - preview.beforePercent)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LevelChip level={preview.beforeCenterLevel} />
              <ArrowRight className="size-4 text-nv-navy-400" aria-hidden />
              <LevelChip level={preview.afterCenterLevel} />
              <span className="basis-full text-nv-navy-400 text-xs">{previewMessage(preview)}</span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => item && onConfirm(item.id, amount)}
          disabled={item === null}
          className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <HandHeart className="size-5" aria-hidden />
          Confirmar donación
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm"
        >
          <X className="size-5" aria-hidden />
          Cancelar
        </button>
      </DialogContent>
    </Dialog>
  );
}
