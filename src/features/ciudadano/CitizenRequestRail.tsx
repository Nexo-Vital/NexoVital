import { Ambulance, Check, Clock, Flag, Info, MapPin, Phone, Radio, X } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  CITIZEN_ARRIVED_STEP,
  CITIZEN_EN_ROUTE_STEP,
  CITIZEN_TRACKING_STEPS,
  driverInitials,
  formatArrivalClock,
  formatClockTime,
  formatElapsedSince,
  type TimelineEntry,
  TrackingSteps,
  TrackingTimeline,
  unitDetailRows,
} from '@/features/seguimiento/tracking';
import { useClock } from '@/hooks/use-clock';
import { distanceKm, etaMinutes } from '@/lib/geo';
import { cn } from '@/lib/utils';
import type { Ambulancia, Ubicacion } from '@/types/domain';
import { formatUnitList, searchElapsed, searchIntroText } from './citizen-request';
import type { CitizenRequestPhase } from './citizen-request-store';
import {
  CITIZEN_UNIT_META,
  citizenUnitStatus,
  formatDistance,
  type NearbyAmbulance,
  nearbyAmbulances,
} from './citizen-view';

/** Card shell shared with the citizen rail: same panel, same shadow. */
function RailPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-3 rounded-nv-lg bg-white p-4 shadow-nv-card"
    >
      {children}
    </section>
  );
}

/**
 * Search panel (mockup `C.c3`): the spinner, the "Buscando ambulancia" heading,
 * the copy adjusted to the real number of alerted units and the live counter.
 */
function SearchingPanel({
  notifiedCount,
  startedAt,
}: {
  notifiedCount: number;
  startedAt: number;
}) {
  const now = useClock(1000);
  return (
    <RailPanel label="Búsqueda de ambulancia">
      <div className="flex flex-col items-center gap-3.5 px-1 py-2 text-center">
        <span className="relative flex size-16 items-center justify-center text-nv-navy">
          <span className="nv-spinner" aria-hidden />
          <Radio className="size-[26px]" aria-hidden />
        </span>
        <h3 className="font-semibold text-lg">Buscando ambulancia</h3>
        <p className="text-nv-navy-400 text-[13.5px] leading-5">{searchIntroText(notifiedCount)}</p>
        <span className="inline-flex items-center gap-1.5 rounded-nv-pill bg-nv-sky px-3 py-1.5 font-semibold text-nv-navy text-xs">
          <Clock className="size-3.5" aria-hidden />
          Buscando hace {searchElapsed(startedAt, now)}
        </span>
      </div>
    </RailPanel>
  );
}

/** One alerted unit: the rail's usual distance/ETA line plus the "Avisada" chip. */
function NotifiedRow({ item }: { item: NearbyAmbulance }) {
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
      <span className="inline-flex shrink-0 items-center gap-1 rounded-nv-pill bg-nv-sky px-2.5 py-1 font-semibold text-nv-navy text-xs">
        <Radio className="size-3.5" aria-hidden />
        Avisada
      </span>
    </li>
  );
}

/**
 * "Ambulancias avisadas": one row per alerted unit, plus the footer naming the
 * occupied units that did NOT get the alert (their real ids, never a promise).
 */
function NotifiedPanel({ rows, occupiedIds }: { rows: NearbyAmbulance[]; occupiedIds: string[] }) {
  return (
    <RailPanel label="Ambulancias avisadas">
      <h4 className="flex items-center gap-2 font-bold text-sm">
        <Radio className="size-4 text-nv-navy" aria-hidden />
        Ambulancias avisadas
      </h4>
      <ul className="flex list-none flex-col gap-2.5 p-0">
        {rows.map((item) => (
          <NotifiedRow key={item.ambulance.id} item={item} />
        ))}
      </ul>
      {occupiedIds.length > 0 && (
        <p className="flex items-start gap-2 rounded-nv-md bg-nv-mint p-3 text-nv-navy-400 text-xs leading-[18px]">
          <Info className="mt-0.5 size-4 shrink-0 text-nv-navy-600" aria-hidden />
          <span>Las ambulancias ocupadas ({formatUnitList(occupiedIds)}) no reciben el aviso.</span>
        </p>
      )}
    </RailPanel>
  );
}

/**
 * `C.c4` tracking rail, shown once the arbiter assigned OUR request: the status
 * panel with the computed ETA and the live step, the assigned driver and unit
 * with their real data, and the two citizen actions. It replaces the search rail
 * for good — the acceptance popup only announces the change.
 */
function AcceptedTrackingPanel({
  unitId,
  acceptedAt,
  unit,
  origin,
  onCancel,
}: {
  unitId: string;
  acceptedAt: number | null;
  unit: Ambulancia | null;
  origin: Ubicacion;
  onCancel: () => void;
}) {
  const now = useClock(1000);
  const km = unit ? distanceKm(unit.ubicacion, origin) : null;
  const etaMin = unit ? etaMinutes(unit.ubicacion, origin) : null;
  // The arrival clock is anchored to the acceptance instant, so it is computed
  // once and stays fixed (C3). Anchoring it to the ticking clock made "llega
  // HH:MM" advance one minute every minute. The "hace N s" counter below keeps
  // reading the live `now`, which is the correct behaviour.
  const arrivalClock =
    etaMin !== null && acceptedAt !== null
      ? formatArrivalClock(etaMin, new Date(acceptedAt))
      : null;
  const statusLine =
    km !== null && etaMin !== null && arrivalClock !== null
      ? `${formatDistance(km)} · llega ${arrivalClock}`
      : 'Sin ubicación de la unidad';
  const detailRows = unit ? unitDetailRows(unit) : [{ label: 'Unidad', value: unitId }];

  return (
    <>
      <RailPanel label="Estado de la solicitud">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-nv-pill bg-nv-teal px-2.5 py-1 font-semibold text-nv-navy text-xs">
            <Check className="size-3.5" aria-hidden />
            Aceptada
          </span>
          <span className="flex-1" />
          {acceptedAt !== null && (
            <span className="tabular text-nv-navy-400 text-[12.5px]">
              {formatElapsedSince(acceptedAt, now)}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-2.5">
          <b className="tabular font-bold text-[34px] leading-10 tracking-tight">
            {etaMin !== null ? `${etaMin} min` : '—'}
          </b>
          <span className="text-nv-navy-400 text-sm">{statusLine}</span>
        </div>
        <TrackingSteps
          steps={CITIZEN_TRACKING_STEPS}
          activeIndex={CITIZEN_EN_ROUTE_STEP}
          label="Progreso de tu solicitud"
        />
      </RailPanel>

      <RailPanel label="Conductor asignado">
        {unit && (
          <div className="flex items-center gap-3">
            <span className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-nv-sky font-bold text-lg text-nv-navy">
              {driverInitials(unit.driverName)}
            </span>
            <span className="min-w-0 flex-1">
              <b className="block truncate font-semibold text-base">{unit.driverName}</b>
              <small className="block text-nv-navy-400 text-xs">Conductor de la ambulancia</small>
            </span>
          </div>
        )}
        <div>
          {detailRows.map((row) => (
            <div
              key={row.label}
              className="flex items-center gap-3 border-nv-line border-b py-3 last:border-b-0"
            >
              <span className="w-[104px] shrink-0 text-nv-navy-400 text-xs">{row.label}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-sm">{row.value}</span>
            </div>
          ))}
        </div>
      </RailPanel>

      <button
        type="button"
        disabled
        title="Aún no hay un número de contacto en los datos de la unidad."
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Phone className="size-5" aria-hidden />
        Llamar al conductor
      </button>
      <p className="text-nv-navy-400 text-xs">
        Llamar al conductor se habilitará cuando los datos de la unidad incluyan un número de
        contacto.
      </p>

      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm"
      >
        <X className="size-5" aria-hidden />
        Cancelar solicitud
      </button>
    </>
  );
}

interface CitizenRequestRailProps {
  phase: CitizenRequestPhase;
  notifiedIds: string[];
  startedAt: number | null;
  acceptedBy: string | null;
  acceptedAt: number | null;
  arrivedAt: number | null;
  confirmedAt: number | null;
  units: Ambulancia[];
  origin: Ubicacion;
  onCancel: () => void;
  /** `C.c6` action: drops the closed request and returns to the map rail. */
  onBackToMap: () => void;
}

/**
 * `C.c5` status panel: the "Llegó" chip, the REAL arrival clock and the step-4
 * stepper. The answer itself lives in the modal, which the page mounts on top.
 *
 * It also carries the honest exit for a false arrival: "Cancelar solicitud" is
 * reachable as soon as the modal is dismissed, so the citizen is never forced to
 * confirm a lie or reload the page. This is the existing cancellation, not a new
 * dispute flow.
 */
function ArrivedPanel({ arrivedAt, onCancel }: { arrivedAt: number | null; onCancel: () => void }) {
  return (
    <>
      <RailPanel label="Estado de la solicitud">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-nv-pill bg-nv-teal px-2.5 py-1 font-semibold text-nv-navy text-xs">
            <Flag className="size-3.5" aria-hidden />
            Llegó
          </span>
        </div>
        <div className="flex items-baseline gap-2.5">
          <b className="tabular font-bold text-[34px] leading-10 tracking-tight">
            {arrivedAt !== null ? formatClockTime(arrivedAt) : '—'}
          </b>
          <span className="text-nv-navy-400 text-sm">hora de llegada</span>
        </div>
        <TrackingSteps
          steps={CITIZEN_TRACKING_STEPS}
          activeIndex={CITIZEN_ARRIVED_STEP}
          label="Progreso de tu solicitud"
        />
      </RailPanel>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm"
      >
        <X className="size-5" aria-hidden />
        Cancelar solicitud
      </button>
    </>
  );
}

/**
 * `C.c6` closed-request panel: the check, the honest "no longer active" line and
 * the REAL timeline (every instant comes from the relay events, never the
 * mockup's hand-written hours).
 */
function CompletedPanel({
  unit,
  unitId,
  startedAt,
  acceptedAt,
  arrivedAt,
  confirmedAt,
  onBackToMap,
}: {
  unit: Ambulancia | null;
  unitId: string;
  startedAt: number | null;
  acceptedAt: number | null;
  arrivedAt: number | null;
  confirmedAt: number | null;
  onBackToMap: () => void;
}) {
  const driver = unit?.driverName;
  const entries: TimelineEntry[] = [
    { text: 'Pediste una ambulancia', at: startedAt },
    {
      text: driver
        ? `${driver} aceptó con la ${unitId}`
        : `La unidad ${unitId} aceptó tu solicitud`,
      at: acceptedAt,
    },
    { text: 'La ambulancia llegó', at: arrivedAt },
    { text: 'Confirmaste la llegada', at: confirmedAt },
  ];

  return (
    <>
      <RailPanel label="Solicitud atendida">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-nv-lime text-nv-navy">
            <Check className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-[17px]">Solicitud atendida</h3>
            <p className="text-nv-navy-400 text-xs">Ya no figura entre tus solicitudes activas</p>
          </div>
        </div>
        <TrackingTimeline entries={entries} label="Línea de tiempo de tu solicitud" />
      </RailPanel>
      <button
        type="button"
        onClick={onBackToMap}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white"
      >
        <MapPin className="size-5" aria-hidden />
        Volver al mapa
      </button>
    </>
  );
}

/**
 * The citizen rail while a request is open: the search panel and the alerted
 * units, or the `C.c4`/`C.c5`/`C.c6` rail once a unit accepted. `acceptedBy` is
 * the real winner reported by the arbiter, so the assigned unit is looked up in
 * the live fleet instead of being assumed.
 */
export function CitizenRequestRail({
  phase,
  notifiedIds,
  startedAt,
  acceptedBy,
  acceptedAt,
  arrivedAt,
  confirmedAt,
  units,
  origin,
  onCancel,
  onBackToMap,
}: CitizenRequestRailProps) {
  if (acceptedBy && (phase === 'accepted' || phase === 'arrived' || phase === 'closed')) {
    const assignedUnit = units.find((unit) => unit.id === acceptedBy) ?? null;
    return (
      <aside
        aria-label="Panel del ciudadano"
        className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto"
      >
        {phase === 'closed' ? (
          <CompletedPanel
            unit={assignedUnit}
            unitId={acceptedBy}
            startedAt={startedAt}
            acceptedAt={acceptedAt}
            arrivedAt={arrivedAt}
            confirmedAt={confirmedAt}
            onBackToMap={onBackToMap}
          />
        ) : phase === 'arrived' ? (
          <ArrivedPanel arrivedAt={arrivedAt} onCancel={onCancel} />
        ) : (
          <AcceptedTrackingPanel
            unitId={acceptedBy}
            acceptedAt={acceptedAt}
            unit={assignedUnit}
            origin={origin}
            onCancel={onCancel}
          />
        )}
      </aside>
    );
  }

  const notifiedUnits = units.filter((unit) => notifiedIds.includes(unit.id));
  const rows = nearbyAmbulances(notifiedUnits, origin, notifiedUnits.length);
  const occupiedIds = units
    .filter((unit) => citizenUnitStatus(unit.estado) === 'busy')
    .map((unit) => unit.id);

  return (
    <aside
      aria-label="Panel del ciudadano"
      className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto"
    >
      <SearchingPanel notifiedCount={notifiedIds.length} startedAt={startedAt ?? Date.now()} />
      {/*
        Cancel sits right under the search status, NOT last. It used to be the
        final element, so on a phone it fell below the fold and looked missing:
        the citizen had to scroll past the whole notified list to find the way
        out of a search they could not stop. The action that ends the wait has
        to be reachable without scrolling.
      */}
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm"
      >
        <X className="size-5" aria-hidden />
        Cancelar solicitud
      </button>
      <NotifiedPanel rows={rows} occupiedIds={occupiedIds} />
    </aside>
  );
}
