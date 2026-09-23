import type { LucideIcon } from 'lucide-react';
import {
  Ambulance,
  Check,
  ClipboardList,
  Clock,
  Crosshair,
  Info,
  MapPin,
  Navigation,
  Power,
  Radio,
  Timer,
  User,
  Warehouse,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import {
  CENTER_LEVEL_STYLE,
  CITIZEN_LEVEL_META,
  CITIZEN_UNIT_META,
  centerLevel,
  centerNeedLabel,
  citizenUnitStatus,
  formatDistance,
} from '@/features/ciudadano/citizen-view';
import {
  type DeviceLocationState,
  INSECURE_CONTEXT_MESSAGE,
  SIMULATED_START,
} from '@/features/geolocalizacion/use-device-location';
import { EMERGENCY_LEVEL_META } from '@/features/solicitudes/request-status';
import { useClock } from '@/hooks/use-clock';
import { formatCountdown, formatElapsed } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SolicitudBroadcastPayload } from '@/shared/realtime';
import type { Ambulancia, CentroAyuda } from '@/types/domain';
import { DRIVER_STATUS_META, DRIVER_STATUS_ORDER, type DriverStatus } from './driver-status';
import type { Mission, SolicitudPhase } from './use-solicitud-inbox';

/** Panel shell shared by the three rail blocks: same card as the citizen rail. */
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

/** Spanish position hint for the simulation fallback, one per device status. */
function locationHint(location: DeviceLocationState): { text: string; tone: string } {
  switch (location.status) {
    case 'unsupported':
      return { text: INSECURE_CONTEXT_MESSAGE, tone: 'text-warning' };
    case 'denied':
      return {
        text: 'Permiso de ubicación denegado. Actívalo en los ajustes del navegador o simula una posición.',
        tone: 'text-critical',
      };
    case 'unavailable':
      return {
        text: 'La ubicación no está disponible ahora. Inténtalo de nuevo en un momento o simula una posición.',
        tone: 'text-warning',
      };
    case 'granted':
      return { text: 'Posición GPS en vivo.', tone: 'text-ok' };
    default:
      return { text: 'Esperando el permiso de ubicación…', tone: 'text-muted-foreground' };
  }
}

/**
 * "Tu ambulancia": the unit this driver operates, and every control that used
 * to live in the retired bottom sheet (connection, the four driver states and
 * the simulation fallback).
 *
 * The status chip uses the DRIVER's own vocabulary through `DRIVER_STATUS_META`
 * — Disponible / En ruta / En escena / Fuera de servicio — never the vehicle
 * buckets, so "off duty" cannot read as "En mantenimiento". The icon keeps the
 * shared unit marker meta because it is a map-availability glyph, not a label.
 *
 * The secondary line only carries what the domain actually has. There is no
 * model or unit type, so none is invented: the zone is shown when present.
 */
function MyUnitPanel({
  unitId,
  unit,
  status,
  online,
  onStatusChange,
  onGoOnline,
  onGoOffline,
  mission,
  location,
}: {
  unitId: string;
  unit: Ambulancia | null;
  status: DriverStatus;
  online: boolean;
  onStatusChange: (status: DriverStatus) => void;
  onGoOnline: () => void;
  onGoOffline: () => void;
  mission: Mission | null;
  location: DeviceLocationState;
}) {
  const meta = CITIZEN_UNIT_META[citizenUnitStatus(DRIVER_STATUS_META[status].estado)];
  const driverMeta = DRIVER_STATUS_META[status];
  const hint = locationHint(location);
  const levelMeta = mission ? EMERGENCY_LEVEL_META[mission.nivel] : null;
  const plate = unit?.placa;
  const zone = unit?.zona;

  return (
    <RailPanel label="Tu ambulancia">
      <h4 className="flex items-center gap-2 font-bold text-sm">
        <Ambulance className="size-4 text-nv-navy" aria-hidden />
        Tu ambulancia
      </h4>
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full',
            meta.markerClass,
          )}
        >
          <Ambulance className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate font-semibold text-[15px]">
            {unitId}
            {plate ? ` · ${plate}` : ''}
          </b>
          {zone ? <small className="block truncate text-nv-navy-400 text-xs">{zone}</small> : null}
        </span>
        <span
          data-testid="driver-status-chip"
          className={cn(
            'shrink-0 rounded-nv-pill px-2.5 py-1 font-semibold text-xs',
            driverMeta.chipClass,
          )}
        >
          {driverMeta.label}
        </span>
      </div>

      {/* Connection: the old "Go online" / "Go offline" control, now in Spanish. */}
      <div className="flex flex-col gap-2 border-nv-line border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="nv-label text-nv-navy-400">Conexión</span>
          <span
            className={cn(
              'shrink-0 rounded-nv-pill px-2.5 py-1 font-semibold text-xs',
              online ? 'bg-nv-lime text-nv-navy' : 'bg-idle/15 text-idle',
            )}
          >
            {online ? 'En línea' : 'Desconectado'}
          </span>
        </div>
        {online ? (
          <button
            type="button"
            onClick={onGoOffline}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-4 font-semibold text-nv-navy text-sm"
          >
            <Power className="size-4" aria-hidden />
            Desconectarse
          </button>
        ) : (
          <button
            type="button"
            onClick={onGoOnline}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-4 font-semibold text-sm text-white"
          >
            <Power className="size-4" aria-hidden />
            Conectarse
          </button>
        )}
      </div>

      {/* The four driver states, as selectable buttons marked with aria-pressed. */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="nv-label text-nv-navy-400">Mi estado</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {DRIVER_STATUS_ORDER.map((value) => {
            const valueMeta = DRIVER_STATUS_META[value];
            const active = status === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onStatusChange(value)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-nv-md border-[1.5px] px-3 py-2 text-left font-semibold text-xs',
                  active
                    ? 'border-nv-navy bg-nv-navy text-white'
                    : 'border-nv-line bg-white text-nv-navy',
                )}
              >
                <span
                  className={cn('size-2 shrink-0 rounded-full', valueMeta.dotClass)}
                  aria-hidden
                />
                {valueMeta.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {mission && levelMeta && (
        <div className="flex flex-col gap-2 rounded-nv-md border border-nv-line bg-nv-mint p-3">
          <div className="flex items-center gap-2">
            <Navigation className="size-4 text-nv-navy-600" aria-hidden />
            <span className="nv-label text-nv-navy-400">Misión actual</span>
            <span
              className={cn(
                'ml-auto shrink-0 rounded-nv-pill border px-2.5 py-1 font-semibold text-xs',
                levelMeta.borderClass,
                levelMeta.textClass,
              )}
            >
              {levelMeta.label}
            </span>
          </div>
          <p className="font-medium text-sm">{mission.tipo}</p>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-nv-navy-400">
              <MapPin className="size-3.5" aria-hidden />
              {mission.zonaId}
            </span>
            <span className="tabular ml-auto font-medium">ETA {mission.etaMinutes} min</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-nv-md border border-nv-line p-3">
        <div className="flex items-center gap-2">
          <Crosshair className="size-4 text-nv-navy-400" aria-hidden />
          <span className="nv-label text-nv-navy-400">Mi posición</span>
          {location.simulated && (
            <span className="ml-auto shrink-0 rounded-nv-pill border border-nv-amber px-2.5 py-1 font-semibold text-nv-amber text-xs">
              Simulada
            </span>
          )}
        </div>
        <p className={cn('text-xs', hint.tone)}>{hint.text}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => location.setSimulatedPosition(location.position ?? SIMULATED_START)}
            className={cn(
              'inline-flex items-center justify-center rounded-nv-md px-3 py-2 font-semibold text-xs',
              location.simulated
                ? 'bg-nv-navy text-white'
                : 'border-[1.5px] border-nv-line bg-white text-nv-navy',
            )}
          >
            {location.simulated ? 'Recentrar simulación' : 'Simular posición'}
          </button>
          {location.simulated && (
            <button
              type="button"
              onClick={location.clearSimulated}
              className="inline-flex items-center justify-center rounded-nv-md px-3 py-2 font-semibold text-nv-navy-400 text-xs"
            >
              Usar GPS del dispositivo
            </button>
          )}
        </div>
        {location.simulated && (
          <p className="text-nv-navy-400 text-[11px]">
            Toca el mapa o arrastra el marcador SIM para moverte. La posición se publica en
            /topic/flota como unidad simulada.
          </p>
        )}
      </div>
    </RailPanel>
  );
}

/**
 * Live countdown chip of the request card. It fires `onTimeout` exactly once
 * when the real accept window reaches zero, so the inbox phase can move to
 * "expired" without any external timer.
 */
function RequestCountdown({
  deadlineMs,
  onTimeout,
}: {
  deadlineMs: number;
  onTimeout: () => void;
}) {
  const now = useClock(250);
  const firedRef = useRef(false);
  const remainingMs = Math.max(0, deadlineMs - now.getTime());

  useEffect(() => {
    if (remainingMs <= 0 && !firedRef.current) {
      firedRef.current = true;
      onTimeout();
    }
  }, [remainingMs, onTimeout]);

  const secondsLeft = Math.ceil(remainingMs / 1000);

  return (
    <span
      role="timer"
      aria-label={`${secondsLeft} segundos para responder`}
      className="tabular inline-flex shrink-0 items-center gap-1.5 rounded-nv-pill bg-nv-red-soft px-2.5 py-1 font-bold text-nv-red-600 text-sm"
    >
      <Timer className="size-3.5" aria-hidden />
      {formatCountdown(new Date(deadlineMs).toISOString(), now)}
    </span>
  );
}

/** One `data-row`: gray key, bold value, glyph on the right. */
function RequestDataRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex items-center gap-3 border-nv-line border-b py-3 last:border-b-0">
      <span className="w-[104px] shrink-0 text-nv-navy-400 text-xs">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium text-sm">{value}</span>
      <Icon className="size-[17px] shrink-0 text-nv-navy-400" aria-hidden />
    </div>
  );
}

/** "A-12 y A-03" / "A-01, A-12 y A-03"; the notified list, never the own unit. */
function unitListLabel(ids: string[]): string {
  if (ids.length === 1) {
    return ids[0];
  }
  return `${ids.slice(0, -1).join(', ')} y ${ids[ids.length - 1]}`;
}

interface RequestCardProps {
  broadcast: SolicitudBroadcastPayload;
  phase: SolicitudPhase;
  outcomeMessage: string | null;
  deadlineMs: number | null;
  windowMs: number;
  distanceKm: number | null;
  etaMin: number | null;
  requestedAtMs: number | null;
  unitId: string;
  onAccept: () => void;
  onReject: () => void;
  onTimeout: () => void;
}

/**
 * The mockup's `request-card`: red top border, countdown chip, four data rows,
 * the notified-units note and the two actions. Accept/Reject live here now that
 * the modal overlay is gone, and the inbox outcome is announced in the same
 * card, so no feedback the overlay used to give is lost.
 */
function RequestCard({
  broadcast,
  phase,
  outcomeMessage,
  deadlineMs,
  windowMs,
  distanceKm,
  etaMin,
  requestedAtMs,
  unitId,
  onAccept,
  onReject,
  onTimeout,
}: RequestCardProps) {
  const now = useClock(1000);
  const decided =
    phase === 'assigned' || phase === 'taken' || phase === 'rejected' || phase === 'timeout';
  const isSubmitting = phase === 'submitting';
  const others = broadcast.notificadas.filter((id) => id !== unitId);
  const windowSeconds = Math.max(1, Math.round(windowMs / 1000));
  // The emergency level is a real payload field; the chip reads the shared
  // `EMERGENCY_LEVEL_META` table so its label/colour cannot drift from the map
  // legend and the CRUE registry.
  const levelMeta = EMERGENCY_LEVEL_META[broadcast.nivel];

  const distanceLabel =
    distanceKm !== null
      ? `${formatDistance(distanceKm)}${etaMin !== null ? ` · ${etaMin} min` : ''}`
      : 'Sin ubicación';
  const requestedLabel =
    requestedAtMs !== null ? formatElapsed(new Date(requestedAtMs).toISOString(), now) : '—';

  const hint =
    broadcast.mode === 'direct'
      ? `Solicitud dirigida solo a tu unidad. Si no respondes en ${windowSeconds} s, deja de mostrarse aquí.`
      : others.length > 0
        ? `También se avisó a ${unitListLabel(others)}. La solicitud es de quien acepte primero; si no respondes en ${windowSeconds} s, deja de mostrarse aquí.`
        : `La solicitud es de quien acepte primero; si no respondes en ${windowSeconds} s, deja de mostrarse aquí.`;

  return (
    <section
      aria-label="Solicitud de ambulancia"
      className="flex flex-col gap-3.5 rounded-nv-lg border-nv-red-600 border-t-[5px] bg-white p-4 shadow-nv-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-semibold text-[17px]">Solicitud de ambulancia</h3>
        <span
          className={cn(
            'shrink-0 rounded-nv-pill border px-2.5 py-1 font-semibold text-xs',
            levelMeta.borderClass,
            levelMeta.textClass,
          )}
        >
          {levelMeta.label}
        </span>
        <span className="flex-1" />
        {!decided && deadlineMs !== null && (
          <RequestCountdown deadlineMs={deadlineMs} onTimeout={onTimeout} />
        )}
      </div>

      <div>
        {/*
          The mockup labels this first slot "Solicitante" (e.g. "Juan M. ·
          ciudadano"). There is no requester name in the request domain — that
          belongs to the citizen data stage — so the key names what the value
          really is: the emergency the request points at, shown with its real
          type (`EMG-002 · Traffic collision`). The mockup's requester name stays
          pending until that data stage exists.
        */}
        <RequestDataRow
          label="Emergencia"
          value={`${broadcast.emergenciaId} · ${broadcast.tipo}`}
          icon={User}
        />
        <RequestDataRow label="Ubicación" value={broadcast.zonaId} icon={MapPin} />
        <RequestDataRow label="Distancia" value={distanceLabel} icon={Navigation} />
        <RequestDataRow label="Solicitada" value={requestedLabel} icon={Clock} />
      </div>

      <p className="flex items-start gap-2 rounded-nv-md bg-nv-mint p-3 text-nv-navy-400 text-xs leading-[18px]">
        <Info className="mt-0.5 size-4 shrink-0 text-nv-navy-600" aria-hidden />
        <span>{hint}</span>
      </p>

      {(phase === 'idle' || isSubmitting) && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={isSubmitting}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="size-5" aria-hidden />
            {isSubmitting ? 'Enviando…' : 'Aceptar solicitud'}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={isSubmitting}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="size-5" aria-hidden />
            Rechazar
          </button>
        </div>
      )}

      <p
        role="status"
        aria-live="assertive"
        className={cn(
          'min-h-5 text-xs',
          phase === 'assigned' && 'font-medium text-ok',
          phase === 'taken' && 'text-warning',
          phase === 'timeout' && 'text-critical',
          isSubmitting && 'text-nv-navy-400',
        )}
      >
        {outcomeMessage ??
          (broadcast.mode === 'direct'
            ? `Dirigida a ${broadcast.targetAmbulanceId ?? 'tu unidad'}. Solo se avisó a esta unidad.`
            : 'Difundida a varias unidades. Gana quien acepte primero.')}
      </p>
    </section>
  );
}

/**
 * "Solicitudes": mirrors the driver's live inbox. With no active broadcast it
 * shows the mockup's empty state; with one pending it renders the request card,
 * which now owns accept/reject and the inbox outcome.
 */
function RequestsPanel(props: RequestPanelProps) {
  if (!props.broadcast) {
    return (
      <RailPanel label="Solicitudes">
        <h4 className="flex items-center gap-2 font-bold text-sm">
          <ClipboardList className="size-4 text-nv-navy" aria-hidden />
          Solicitudes
        </h4>
        <div className="flex flex-col items-center gap-1.5 rounded-nv-md border border-dashed border-nv-line px-4 py-6 text-center">
          <Radio className="size-6 text-nv-teal" aria-hidden />
          <b className="font-semibold text-sm">Sin solicitudes por ahora</b>
          <span className="text-nv-navy-400 text-xs leading-[18px]">
            Cuando alguien cerca pida una ambulancia te avisaremos aquí, con sonido.
          </span>
        </div>
      </RailPanel>
    );
  }
  return <RequestCard {...props} broadcast={props.broadcast} />;
}

/**
 * One aid-center row. Level icon, name, need and level chip all read the shared
 * `citizen-view` meta; no second colour table is declared here.
 */
function AidCenterRow({ centro }: { centro: CentroAyuda }) {
  const level = centerLevel(centro);
  const meta = level ? CITIZEN_LEVEL_META[level] : null;
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

function AidCentersPanel({ centros }: { centros: CentroAyuda[] }) {
  return (
    <RailPanel label="Centros de acopio cercanos">
      <h4 className="flex items-center gap-2 font-bold text-sm">
        <Warehouse className="size-4 text-nv-navy" aria-hidden />
        Centros de acopio cercanos
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
    </RailPanel>
  );
}

/** Props of the live request inbox panel, wired from the driver page. */
interface RequestPanelProps {
  broadcast: SolicitudBroadcastPayload | null;
  phase: SolicitudPhase;
  outcomeMessage: string | null;
  deadlineMs: number | null;
  windowMs: number;
  /** Distance and ETA from the driver to the scene, or null without a position. */
  distanceKm: number | null;
  etaMin: number | null;
  /** When the request was raised; drives the "Solicitada" row. */
  requestedAtMs: number | null;
  unitId: string;
  onAccept: () => void;
  onReject: () => void;
  onTimeout: () => void;
}

interface DriverRailProps {
  /** Id of the unit this driver operates. */
  unitId: string;
  /** The unit as hydrated in the fleet store, or null before it is known. */
  unit: Ambulancia | null;
  /** The driver's declared status, the source of the availability chip. */
  status: DriverStatus;
  /** Whether the driver is connected to the service. */
  online: boolean;
  /** Sets the driver's declared status from the panel buttons. */
  onStatusChange: (status: DriverStatus) => void;
  onGoOnline: () => void;
  onGoOffline: () => void;
  /** The assigned mission, shown in "Tu ambulancia", or null. */
  mission: Mission | null;
  /** Device/simulated position state, rendered as the simulation fallback. */
  location: DeviceLocationState;
  /** The live request inbox, rendered as the request card. */
  request: RequestPanelProps;
  /** Aid centers to list, nearest first is not guaranteed by the fixture. */
  centros: CentroAyuda[];
}

/** Driver rail: own unit, the live request inbox and the nearby aid centers. */
export function DriverRail({
  unitId,
  unit,
  status,
  online,
  onStatusChange,
  onGoOnline,
  onGoOffline,
  mission,
  location,
  request,
  centros,
}: DriverRailProps) {
  return (
    <aside
      aria-label="Panel del conductor"
      className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto"
    >
      <MyUnitPanel
        unitId={unitId}
        unit={unit}
        status={status}
        online={online}
        onStatusChange={onStatusChange}
        onGoOnline={onGoOnline}
        onGoOffline={onGoOffline}
        mission={mission}
        location={location}
      />
      <RequestsPanel {...request} />
      <AidCentersPanel centros={centros} />
    </aside>
  );
}
