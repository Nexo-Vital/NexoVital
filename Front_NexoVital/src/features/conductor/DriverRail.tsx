import type { LucideIcon } from 'lucide-react';
import {
  Ambulance,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  Eye,
  Info,
  MapPin,
  Navigation,
  Power,
  Radio,
  Timer,
  User,
  Volume2,
  VolumeX,
  Warehouse,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { formatCoordinates } from '@/features/ciudadano/citizen-request';
import {
  CENTER_LEVEL_STYLE,
  CITIZEN_LEVEL_META,
  CITIZEN_UNIT_META,
  centerLevel,
  centerNeedLabel,
  citizenCenterLevel,
  citizenUnitStatus,
  formatDistance,
} from '@/features/ciudadano/citizen-view';
import { LocationSimulationControls } from '@/features/geolocalizacion/LocationSimulationControls';
import type { DeviceLocationState } from '@/features/geolocalizacion/use-device-location';
import { unitPlateLabel } from '@/features/seguimiento/tracking';
import {
  EMERGENCY_LEVEL_META,
  REQUEST_STATE_LABEL_ES,
} from '@/features/solicitudes/request-status';
import { useClock } from '@/hooks/use-clock';
import { formatCountdown, formatDateTime, formatElapsed } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SolicitudBroadcastPayload } from '@/shared/realtime';
import type {
  Ambulancia,
  CentroAyuda,
  EmergencyLevel,
  InventarioItem,
  SolicitudAmbulancia,
} from '@/types/domain';
import { DriverMissionPanel } from './DriverMissionPanel';
import { DRIVER_STATUS_META, DRIVER_STATUS_ORDER, type DriverStatus } from './driver-status';
import {
  isSoundSupported,
  isSoundUnlocked,
  subscribeSoundStatus,
  unlockSound,
} from './request-sound';
import type {
  DriverMissionPhase,
  Mission,
  SolicitudPhase,
  SolicitudResponseOutcome,
} from './use-solicitud-inbox';
import { UNIT_UNRESOLVED_REASON } from './use-solicitud-inbox';

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

/**
 * Emergency-level chip. A request with no declared level (a citizen request has
 * no triage behind it) reads "Sin clasificar" instead of an invented severity.
 * The colour still comes from the shared `EMERGENCY_LEVEL_META` table.
 */
function LevelChip({ level, className }: { level?: EmergencyLevel; className?: string }) {
  const meta = level ? EMERGENCY_LEVEL_META[level] : null;
  return (
    <span
      className={cn(
        'shrink-0 rounded-nv-pill border px-2.5 py-1 font-semibold text-xs',
        meta ? cn(meta.borderClass, meta.textClass) : 'border-idle/40 text-idle',
        className,
      )}
    >
      {meta ? meta.label : 'Sin clasificar'}
    </span>
  );
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
 * The secondary line mirrors the mockup's "Tu ambulancia" ("Renault Master 2023
 * · Básica (TAB)") when the unit carries a model and type; a unit created in the
 * fleet manager or hydrated from a live frame may not know them yet, so the zone
 * is the honest fallback rather than an invented model.
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
  const missionActive = mission !== null;
  // While a mission is open the unit is genuinely occupied, so the chip reads
  // the vehicle bucket ("Ocupada") the mockup shows in `C.d4`, not the driver's
  // declared availability. The four status buttons keep their own vocabulary.
  const meta =
    CITIZEN_UNIT_META[
      missionActive ? 'busy' : citizenUnitStatus(DRIVER_STATUS_META[status].estado)
    ];
  const driverMeta = DRIVER_STATUS_META[status];
  const chipLabel = missionActive ? CITIZEN_UNIT_META.busy.label : driverMeta.label;
  const chipClass = missionActive ? CITIZEN_UNIT_META.busy.chipClass : driverMeta.chipClass;
  // The unit is named by its plate (never the internal id, which is a UUID off
  // demo); until the fleet hydrates, the id is the only handle available.
  const unitLabel = unit ? unitPlateLabel(unit) : unitId;
  const modelType = unit?.modelo && unit.tipo ? `${unit.modelo} · ${unit.tipo}` : null;
  const secondary = modelType ?? unit?.zona ?? null;

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
          <b className="block truncate font-semibold text-[15px]">{unitLabel}</b>
          {secondary ? (
            <small className="block truncate text-nv-navy-400 text-xs">{secondary}</small>
          ) : null}
        </span>
        <span
          data-testid="driver-status-chip"
          className={cn('shrink-0 rounded-nv-pill px-2.5 py-1 font-semibold text-xs', chipClass)}
        >
          {chipLabel}
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

      {/*
        The mission itself lives in the `C.d4` panel below ("Solicitud
        aceptada"): its type, severity, ETA and scene. Keeping a second copy
        here would show the same data twice.
      */}

      <div className="flex flex-col gap-2 rounded-nv-md border border-nv-line p-3">
        <LocationSimulationControls
          location={location}
          note="Toca el mapa o arrastra el marcador SIM para moverte. La posición se publica en /topic/flota como unidad simulada."
        />
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

/**
 * "SNK-742 y HGV-259" / "WNR-418, SNK-742 y HGV-259"; the notified list, never
 * the own unit.
 *
 * Each id is resolved to its unit's plate through `unitPlateLabel`. An id with
 * no matching fleet unit keeps the raw id instead of being dropped, so the user
 * still sees that the unit was notified; the same honest fallback the helper
 * already encodes for a unit with an unknown plate.
 */
function unitListLabel(ids: string[], units: readonly Ambulancia[]): string {
  const labels = ids.map((id) => {
    const unit = units.find((candidate) => candidate.id === id);
    return unit ? unitPlateLabel(unit) : id;
  });
  if (labels.length === 1) {
    return labels[0];
  }
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

/**
 * Discreet sound affordance. Browsers block audio until a user gesture, so this
 * is the one control that unlocks the synthesized ding. It never claims the
 * sound is active when it is not: while locked it offers "Activar sonido", and
 * a browser without Web Audio says so instead of showing a dead button.
 */
function SoundToggle() {
  const supported = isSoundSupported();
  const unlocked = useSyncExternalStore(subscribeSoundStatus, isSoundUnlocked, () => false);

  if (!supported) {
    return (
      <span className="shrink-0 rounded-nv-pill bg-idle/15 px-2.5 py-1 font-medium text-idle text-xs">
        Sonido no disponible
      </span>
    );
  }
  if (unlocked) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-nv-pill bg-nv-lime px-2.5 py-1 font-semibold text-nv-navy text-xs">
        <Volume2 className="size-3.5" aria-hidden />
        Sonido activado
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void unlockSound()}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-nv-pill border-[1.5px] border-nv-line bg-white px-2.5 py-1 font-semibold text-nv-navy text-xs"
    >
      <VolumeX className="size-3.5" aria-hidden />
      Activar sonido
    </button>
  );
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
  /**
   * False while the driver's OWN unit is unresolved (off-demo, before the
   * server answers). Accept/Reject send `ambulanciaId`, so they stay disabled
   * and the card says why instead of firing an empty id (FIX B).
   */
  unitResolved: boolean;
  onAccept: () => void;
  onReject: () => void;
  onTimeout: () => void;
  /**
   * Fleet units, so the notified ids can be resolved to their plate. An id with
   * no matching unit keeps the raw id (never silently dropped).
   */
  units: readonly Ambulancia[];
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
  unitResolved,
  onAccept,
  onReject,
  onTimeout,
  units,
}: RequestCardProps) {
  const now = useClock(1000);
  const decided =
    phase === 'assigned' || phase === 'taken' || phase === 'rejected' || phase === 'timeout';
  const isSubmitting = phase === 'submitting';
  const others = broadcast.notificadas.filter((id) => id !== unitId);
  const windowSeconds = Math.max(1, Math.round(windowMs / 1000));

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
        ? `También se avisó a ${unitListLabel(others, units)}. La solicitud es de quien acepte primero; si no respondes en ${windowSeconds} s, deja de mostrarse aquí.`
        : `La solicitud es de quien acepte primero; si no respondes en ${windowSeconds} s, deja de mostrarse aquí.`;

  return (
    <section
      aria-label="Solicitud de ambulancia"
      className="flex flex-col gap-3.5 rounded-nv-lg border-nv-red-600 border-t-[5px] bg-white p-4 shadow-nv-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-semibold text-[17px]">Solicitud de ambulancia</h3>
        <LevelChip level={broadcast.nivel} />
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
          value={
            [broadcast.emergenciaId, broadcast.tipo].filter(Boolean).join(' · ') ||
            'Sin emergencia asociada'
          }
          icon={User}
        />
        {/* A citizen request declares no zone, so the coordinates it really
            reported (`escena`) are shown instead of an empty zone slot. A CRUE
            request keeps its declared zone. A backend frame may carry neither,
            and then the row says so instead of inventing a location. */}
        <RequestDataRow
          label="Ubicación"
          value={
            broadcast.zonaId ||
            (broadcast.escena ? formatCoordinates(broadcast.escena) : 'Sin ubicación')
          }
          icon={MapPin}
        />
        <RequestDataRow label="Distancia" value={distanceLabel} icon={Navigation} />
        <RequestDataRow label="Solicitada" value={requestedLabel} icon={Clock} />
      </div>

      <p className="flex items-start gap-2 rounded-nv-md bg-nv-mint p-3 text-nv-navy-400 text-xs leading-[18px]">
        <Info className="mt-0.5 size-4 shrink-0 text-nv-navy-600" aria-hidden />
        <span>{hint}</span>
      </p>

      {(phase === 'idle' || isSubmitting) && (
        <div className="flex flex-col gap-2">
          {/* FIX B: an unresolved unit means there is no `ambulanciaId` to send,
              so both actions stay disabled with an honest reason instead of
              letting the backend drop the request on a 400. */}
          {!unitResolved && (
            <p className="rounded-nv-md bg-nv-mint p-3 text-nv-navy-400 text-xs leading-[18px]">
              {UNIT_UNRESOLVED_REASON}
            </p>
          )}
          <button
            type="button"
            onClick={onAccept}
            disabled={isSubmitting || !unitResolved}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="size-5" aria-hidden />
            {isSubmitting ? 'Enviando…' : 'Aceptar solicitud'}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={isSubmitting || !unitResolved}
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
 * Compact, human reference of a solicitud, used as the identity half of a row
 * label. The raw UUID off the wire is never painted whole: a demo `REQ-1001`
 * becomes `#1001`, any other id keeps its first six significant characters
 * (`#7f6f2f`). It stays short enough to read and unique enough to tell two rows
 * apart.
 */
function solicitudReference(id: string): string {
  const demo = /^REQ-(\d+)$/.exec(id);
  if (demo) {
    return `#${demo[1]}`;
  }
  return `#${id.replace(/-/g, '').slice(0, 6)}`;
}

/**
 * Primary label of a registry row: the request's declared type (never its id),
 * plus the short reference above so two requests of the same type stay
 * distinguishable. A frame with no type still reads honestly as "Solicitud de
 * ambulancia".
 */
function solicitudLabel(solicitud: SolicitudAmbulancia): string {
  return `${solicitud.tipo || 'Solicitud de ambulancia'} · ${solicitudReference(solicitud.id)}`;
}

/**
 * Secondary line of a registry row: where the request is. A citizen request
 * declares no zone, so its own reported coordinates are shown instead; with
 * neither, the emergency reference is the honest fallback.
 */
function solicitudSceneLabel(solicitud: SolicitudAmbulancia): string {
  return (
    solicitud.zonaId ||
    (solicitud.ubicacion ? formatCoordinates(solicitud.ubicacion) : '') ||
    solicitud.emergenciaId ||
    'Sin detalle'
  );
}

/** One selectable registry row; `aria-expanded` mirrors the inline detail. */
function SolicitudRow({
  solicitud,
  selected,
  onSelect,
}: {
  solicitud: SolicitudAmbulancia;
  selected: boolean;
  onSelect: (solicitud: SolicitudAmbulancia) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={selected}
        onClick={() => onSelect(solicitud)}
        className={cn(
          'flex w-full flex-col gap-1 rounded-nv-md border bg-white p-3 text-left',
          selected ? 'border-nv-navy' : 'border-nv-line',
        )}
      >
        <span className="flex items-center gap-2">
          <b className="min-w-0 flex-1 truncate font-semibold text-[13.5px]">
            {solicitudLabel(solicitud)}
          </b>
          <span className="shrink-0 rounded-nv-pill bg-nv-mint px-2 py-0.5 font-medium text-nv-navy-400 text-[11px]">
            {REQUEST_STATE_LABEL_ES[solicitud.estado]}
          </span>
          {selected ? (
            <ChevronUp className="size-4 shrink-0 text-nv-navy-400" aria-hidden />
          ) : (
            <ChevronDown className="size-4 shrink-0 text-nv-navy-400" aria-hidden />
          )}
        </span>
        <small className="block truncate text-nv-navy-400 text-xs">
          {solicitudSceneLabel(solicitud)}
        </small>
      </button>
    </li>
  );
}

/**
 * Inline detail of the selected registry row. It replaces the retired bottom
 * sheet with the same facts (title, emergency, type, location, distance and the
 * notified units) and the same three actions.
 *
 * Aceptar/Rechazar act on THIS row by its id: any request the server would
 * accept — still PENDING and notified to this unit — is actionable, regardless
 * of whether it is the inbox's open broadcast. A row the server would refuse
 * stays disabled with its honest reason, and the response outcome the server
 * gave (won / taken by another unit / refused) is shown right here.
 */
function SolicitudDetail({
  solicitud,
  distanceKm,
  units,
  canRespond,
  blockReason,
  outcome,
  onAccept,
  onReject,
  onView,
  onClose,
}: {
  solicitud: SolicitudAmbulancia;
  distanceKm: number | null;
  units: readonly Ambulancia[];
  canRespond: boolean;
  /** Honest reason the actions are disabled; null while the row is respondible. */
  blockReason: string | null;
  /** Server's answer to this row's last response, or null. */
  outcome: SolicitudResponseOutcome | null;
  onAccept: () => void;
  onReject: () => void;
  onView: () => void;
  onClose: () => void;
}) {
  const notified = solicitud.ambulanciasNotificadas;
  // Retry counter (EP-04.F2.US4): a normal request has none, so the row is only
  // painted once the accept window was re-emitted at least once.
  const reintentos = solicitud.reintentos ?? 0;
  // The request time as a local es-CO instant, reusing the app's existing
  // `formatDateTime`. Rendered only when the timestamp is present and parseable,
  // so a row without one shows no invented time.
  const solicitadaLabel =
    solicitud.solicitadaEn && Number.isFinite(Date.parse(solicitud.solicitadaEn))
      ? formatDateTime(solicitud.solicitadaEn)
      : null;
  return (
    <div
      data-testid="solicitud-detail"
      className="flex flex-col gap-3 rounded-nv-md border border-nv-line bg-white p-3.5"
    >
      <div className="flex items-center gap-2">
        <h5 className="min-w-0 flex-1 truncate font-semibold text-sm">
          {solicitudLabel(solicitud)}
        </h5>
        <span className="shrink-0 rounded-nv-pill bg-nv-mint px-2 py-0.5 font-medium text-nv-navy-400 text-[11px]">
          {REQUEST_STATE_LABEL_ES[solicitud.estado]}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex shrink-0 items-center rounded-nv-md px-2 py-1 font-semibold text-nv-navy-400 text-xs"
        >
          Cerrar
        </button>
      </div>

      <div>
        <RequestDataRow
          label="Emergencia"
          value={solicitud.emergenciaId || 'Sin emergencia asociada'}
          icon={User}
        />
        <RequestDataRow label="Tipo" value={solicitud.tipo || 'Sin clasificar'} icon={Info} />
        {/* A citizen request declares no zone; its own reported coordinates are
            the honest location, never an invented zone. */}
        <RequestDataRow label="Ubicación" value={solicitudSceneLabel(solicitud)} icon={MapPin} />
        {solicitadaLabel && (
          <RequestDataRow label="Solicitada" value={solicitadaLabel} icon={Clock} />
        )}
        <RequestDataRow
          label="Distancia"
          value={distanceKm !== null ? formatDistance(distanceKm) : 'Sin ubicación'}
          icon={Navigation}
        />
        {/*
          ONE notified-units source in the whole panel: the registry ids resolved
          to their plate through `unitListLabel`. The wire-only `notifiedCount`
          number is deliberately not painted, so the panel cannot show two
          different notification figures for the same request.
        */}
        <RequestDataRow
          label="Unidades avisadas"
          value={notified.length > 0 ? unitListLabel(notified, units) : 'Sin unidades avisadas'}
          icon={Radio}
        />
        {/* Only a request whose notice was retried shows the counter; a normal
            request keeps the detail clean. */}
        {reintentos > 0 && (
          <RequestDataRow label="Reintentos" value={String(reintentos)} icon={Clock} />
        )}
      </div>

      {!canRespond && blockReason && (
        <p className="rounded-nv-md bg-nv-mint p-3 text-nv-navy-400 text-xs leading-[18px]">
          {blockReason}
        </p>
      )}

      {outcome && (
        <p
          role="status"
          aria-live="assertive"
          className={cn(
            'min-h-5 text-xs',
            outcome.phase === 'assigned' && 'font-medium text-ok',
            outcome.phase === 'taken' && 'text-warning',
            outcome.phase === 'submitting' && 'text-nv-navy-400',
          )}
        >
          {outcome.message}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={!canRespond}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-5 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="size-5" aria-hidden />
          Aceptar
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={!canRespond}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X className="size-5" aria-hidden />
          Rechazar
        </button>
        <button
          type="button"
          onClick={onView}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-5 font-semibold text-nv-navy text-sm"
        >
          <Eye className="size-5" aria-hidden />
          Visualizar
        </button>
      </div>
    </div>
  );
}

/**
 * "Solicitudes": the ONE panel for the whole request flow. It keeps the live
 * inbox at the top — the `C.d4`/`C.d5` mission rail while a mission is open, the
 * actionable card of the offered broadcast, or the empty state — and below it
 * the ENTIRE registry, every row selectable.
 *
 * Selecting a row expands its detail INLINE (the retired sheet), so the panel
 * never needs a full-screen overlay nor a bottom strip that collides with the
 * rail. Every row the server would accept (still PENDING and notified to this
 * unit) is actionable; the rest stay informational with the honest disabled
 * state and its reason.
 */
function SolicitudesPanel({
  online,
  mission,
  missionDistanceKm,
  missionEtaMin,
  missionLocation,
  missionPhase,
  missionAcceptedAt,
  missionArrivedAt,
  missionConfirmedAt,
  onDeclareArrival,
  onFinish,
  units,
  solicitudes,
  selectedSolicitud,
  selectedCanRespond,
  selectedBlockReason,
  selectedOutcome,
  selectedDistanceKm,
  onSelectSolicitud,
  onAcceptSelected,
  onRejectSelected,
  onViewSelected,
  onCloseSelected,
  ...request
}: RequestPanelProps &
  MissionPanelProps & {
    /** Whether the driver is connected; disconnected the offer surface is hidden. */
    online: boolean;
    mission: Mission | null;
    units: readonly Ambulancia[];
    solicitudes: SolicitudAmbulancia[];
    selectedSolicitud: SolicitudAmbulancia | null;
    selectedCanRespond: boolean;
    /** Honest reason the selected row's actions are disabled, when they are. */
    selectedBlockReason: string | null;
    /** Server's answer to the selected row's last response, or null. */
    selectedOutcome: SolicitudResponseOutcome | null;
    selectedDistanceKm: number | null;
    onSelectSolicitud: (solicitud: SolicitudAmbulancia) => void;
    onAcceptSelected: () => void;
    onRejectSelected: () => void;
    onViewSelected: () => void;
    onCloseSelected: () => void;
  }) {
  // An open offer takes over the panel only while connected: disconnected, the
  // mission (if any) keeps the rail instead of being hidden by a stalled offer.
  const requestOpen = online && (request.phase === 'idle' || request.phase === 'submitting');
  const hasRegistry = solicitudes.length > 0;
  // The sound affordance lives in the panel header in every state, so it is
  // always reachable (the user unlocks audio once, before the next request), and
  // it stays the ONLY instance: the unlock state is a module singleton.
  const header = (
    <div className="flex items-center gap-2">
      <h4 className="flex items-center gap-2 font-bold text-sm">
        <ClipboardList className="size-4 text-nv-navy" aria-hidden />
        Solicitudes
      </h4>
      <span className="shrink-0 rounded-nv-pill bg-nv-mint px-2.5 py-1 font-semibold text-nv-navy text-xs">
        {solicitudes.length}
      </span>
      <span className="ml-auto">
        <SoundToggle />
      </span>
    </div>
  );

  return (
    <RailPanel label="Solicitudes">
      {header}
      {/* Mission precedence: an occupied unit keeps its `C.d4`/`C.d5` panel. A new
          broadcast while occupied still shows its card, because the driver may
          be asked to answer it. */}
      {mission && !requestOpen ? (
        <DriverMissionPanel
          tipo={mission.tipo}
          nivel={mission.nivel}
          distanceKm={missionDistanceKm}
          etaMin={missionEtaMin}
          locationLabel={missionLocation}
          outcomeMessage={request.outcomeMessage}
          phase={missionPhase}
          acceptedAt={missionAcceptedAt}
          arrivedAt={missionArrivedAt}
          confirmedAt={missionConfirmedAt}
          onDeclareArrival={onDeclareArrival}
          onFinish={onFinish}
        />
      ) : !online ? (
        <div
          data-testid="solicitudes-offline"
          className="flex flex-col items-center gap-1.5 rounded-nv-md border border-dashed border-nv-line px-4 py-6 text-center"
        >
          <Radio className="size-6 text-nv-teal" aria-hidden />
          <b className="font-semibold text-sm">Conéctate para recibir solicitudes</b>
          <span className="text-nv-navy-400 text-xs leading-[18px]">
            Mientras estés desconectado no verás solicitudes de ambulancia ni podrás aceptarlas.
          </span>
        </div>
      ) : request.broadcast ? (
        <RequestCard {...request} units={units} broadcast={request.broadcast} />
      ) : hasRegistry ? null : (
        <div className="flex flex-col items-center gap-1.5 rounded-nv-md border border-dashed border-nv-line px-4 py-6 text-center">
          <Radio className="size-6 text-nv-teal" aria-hidden />
          <b className="font-semibold text-sm">Sin solicitudes por ahora</b>
          <span className="text-nv-navy-400 text-xs leading-[18px]">
            Cuando alguien cerca pida una ambulancia te avisaremos aquí, con sonido.
          </span>
        </div>
      )}

      {online && hasRegistry && (
        <div className="flex flex-col gap-2 border-nv-line border-t pt-3">
          <span className="nv-label text-nv-navy-400">Registro</span>
          <ul aria-label="Lista de solicitudes" className="flex list-none flex-col gap-2 p-0">
            {solicitudes.map((solicitud) => (
              <SolicitudRow
                key={solicitud.id}
                solicitud={solicitud}
                selected={selectedSolicitud?.id === solicitud.id}
                onSelect={onSelectSolicitud}
              />
            ))}
          </ul>
        </div>
      )}

      {online && selectedSolicitud && (
        <SolicitudDetail
          solicitud={selectedSolicitud}
          distanceKm={selectedDistanceKm}
          units={units}
          canRespond={selectedCanRespond}
          blockReason={selectedBlockReason}
          outcome={selectedOutcome}
          onAccept={onAcceptSelected}
          onReject={onRejectSelected}
          onView={onViewSelected}
          onClose={onCloseSelected}
        />
      )}
    </RailPanel>
  );
}

/**
 * One inventory line of an expanded aid center: item name, its traffic-light
 * label and the declared quantity. The label reads the SAME
 * `citizenCenterLevel`/`CITIZEN_LEVEL_META` pair the row chip uses, so an item
 * level and the center's worst level can never disagree. The quantity shows
 * `disponible/requerido` when a requirement was declared, else the bare stock;
 * the unit is appended only when the data carries one.
 */
function AidCenterItemRow({ item }: { item: InventarioItem }) {
  const level = citizenCenterLevel(item.semaforo);
  const meta = level ? CITIZEN_LEVEL_META[level] : null;
  const swatchStyle = level
    ? { background: CENTER_LEVEL_STYLE[level].bg, color: CENTER_LEVEL_STYLE[level].fg }
    : undefined;
  const unit = item.unidad ? ` ${item.unidad}` : '';
  const quantity =
    item.requerido > 0
      ? `${item.disponible}/${item.requerido}${unit}`
      : `${item.disponible}${unit}`;

  return (
    <li className="flex items-center gap-2.5">
      <span className="min-w-0 flex-1 truncate text-[13px] text-nv-navy">{item.nombre}</span>
      <span
        className={cn(
          'shrink-0 rounded-nv-pill px-2 py-0.5 font-semibold text-[11px]',
          !swatchStyle && 'bg-idle/15 text-idle ring-1 ring-idle/40',
        )}
        style={swatchStyle}
      >
        {meta ? meta.label : 'Sin declarar'}
      </span>
      <span className="tabular shrink-0 text-nv-navy-400 text-xs">{quantity}</span>
    </li>
  );
}

/**
 * One aid-center row of the accordion. Level icon, name, need and level chip all
 * read the shared `citizen-view` meta; no second colour table is declared here.
 *
 * The row is a full-width button: clicking it (or its chevron) toggles the
 * center's detail, which renders IMMEDIATELY BELOW the row, still inside the
 * same `<li>`. An open row carries `aria-expanded`/`aria-controls` and rotates
 * the chevron; the single-open behaviour is owned by `AidCentersPanel`.
 */
function AidCenterRow({
  centro,
  open,
  onToggle,
}: {
  centro: CentroAyuda;
  open: boolean;
  onToggle: () => void;
}) {
  const level = centerLevel(centro);
  const meta = level ? CITIZEN_LEVEL_META[level] : null;
  const swatchStyle = level
    ? { background: CENTER_LEVEL_STYLE[level].bg, color: CENTER_LEVEL_STYLE[level].fg }
    : undefined;
  const detailId = useId();

  return (
    <li className="rounded-nv-md border border-nv-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 rounded-nv-md p-2.5 text-left"
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
        {open ? (
          <ChevronUp className="size-4 shrink-0 text-nv-navy-400" aria-hidden />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-nv-navy-400" aria-hidden />
        )}
      </button>

      {open && (
        <div
          id={detailId}
          data-testid="aid-center-detail"
          className="flex flex-col gap-2 px-2.5 pb-2.5"
        >
          {centro.items.length === 0 ? (
            <p className="text-nv-navy-400 text-xs">Este centro no declara inventario.</p>
          ) : (
            <ul className="flex list-none flex-col gap-1.5 p-0">
              {centro.items.map((item) => (
                <AidCenterItemRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * "Centros de acopio cercanos" accordion. It owns the single-open state: only
 * one center id is remembered, so opening a center collapses the previous one
 * and toggling the open one closes it. Each detail is rendered by its own row.
 */
function AidCentersPanel({ centros }: { centros: CentroAyuda[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

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
            <AidCenterRow
              key={centro.id}
              centro={centro}
              open={openId === centro.id}
              onToggle={() => setOpenId((current) => (current === centro.id ? null : centro.id))}
            />
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
  /** False while the driver's own unit is unresolved; disables accept/reject (FIX B). */
  unitResolved: boolean;
  onAccept: () => void;
  onReject: () => void;
  onTimeout: () => void;
}

/** Extra inputs the `C.d4`/`C.d5` mission panel needs, computed by the driver page. */
interface MissionPanelProps {
  /** Distance and ETA from the driver to the mission scene. */
  missionDistanceKm: number | null;
  missionEtaMin: number | null;
  /** Real scene label: the declared zone, or the reported coordinates. */
  missionLocation: string;
  /** Mission lifecycle, so the panel renders `d4` or `d5`. */
  missionPhase: DriverMissionPhase;
  /** Real instants of each mission step, for the `d5` timeline. */
  missionAcceptedAt: number | null;
  missionArrivedAt: number | null;
  missionConfirmedAt: number | null;
  onDeclareArrival: () => void;
  onFinish: () => void;
}

interface DriverRailProps extends MissionPanelProps {
  /** Id of the unit this driver operates. */
  unitId: string;
  /** The unit as hydrated in the fleet store, or null before it is known. */
  unit: Ambulancia | null;
  /** The rest of the fleet, so notified ids resolve to their plate. */
  units: readonly Ambulancia[];
  /** The driver's declared status, the source of the availability chip. */
  status: DriverStatus;
  /** Whether the driver is connected to the service. */
  online: boolean;
  /** Sets the driver's declared status from the panel buttons. */
  onStatusChange: (status: DriverStatus) => void;
  onGoOnline: () => void;
  onGoOffline: () => void;
  /** The assigned mission; while it is open the rail shows the `C.d4` panel. */
  mission: Mission | null;
  /** Device/simulated position state, rendered as the simulation fallback. */
  location: DeviceLocationState;
  /** The live request inbox, rendered as the request card. */
  request: RequestPanelProps;
  /** Aid centers to list, nearest first is not guaranteed by the fixture. */
  centros: CentroAyuda[];
  /** Every request in the registry, rendered as the panel's list. */
  solicitudes: SolicitudAmbulancia[];
  /** The row whose detail is expanded inline, or null when none is selected. */
  selectedSolicitud: SolicitudAmbulancia | null;
  /** Whether the selected row can be answered (PENDING and notified to this unit). */
  selectedCanRespond: boolean;
  /** Honest reason the selected row's actions are disabled, when they are. */
  selectedBlockReason: string | null;
  /** Server's answer to the selected row's last response, or null. */
  selectedOutcome: SolicitudResponseOutcome | null;
  /** Distance to the selected row's scene, or null without a resolvable scene. */
  selectedDistanceKm: number | null;
  /** Selects a row: expands its detail and centres the map on it. */
  onSelectSolicitud: (solicitud: SolicitudAmbulancia) => void;
  /** Answers the selected row (by its id) with an accept. */
  onAcceptSelected: () => void;
  /** Answers the selected row (by its id) with a reject. */
  onRejectSelected: () => void;
  /** Collapses the detail and centres the map on the selected scene. */
  onViewSelected: () => void;
  /** Collapses the detail without moving the map. */
  onCloseSelected: () => void;
}

/** Driver rail: own unit, the live request inbox and the nearby aid centers. */
export function DriverRail({
  unitId,
  unit,
  units,
  status,
  online,
  onStatusChange,
  onGoOnline,
  onGoOffline,
  mission,
  missionDistanceKm,
  missionEtaMin,
  missionLocation,
  missionPhase,
  missionAcceptedAt,
  missionArrivedAt,
  missionConfirmedAt,
  onDeclareArrival,
  onFinish,
  location,
  request,
  centros,
  solicitudes,
  selectedSolicitud,
  selectedCanRespond,
  selectedBlockReason,
  selectedOutcome,
  selectedDistanceKm,
  onSelectSolicitud,
  onAcceptSelected,
  onRejectSelected,
  onViewSelected,
  onCloseSelected,
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
      <SolicitudesPanel
        {...request}
        online={online}
        units={units}
        mission={mission}
        missionDistanceKm={missionDistanceKm}
        missionEtaMin={missionEtaMin}
        missionLocation={missionLocation}
        missionPhase={missionPhase}
        missionAcceptedAt={missionAcceptedAt}
        missionArrivedAt={missionArrivedAt}
        missionConfirmedAt={missionConfirmedAt}
        onDeclareArrival={onDeclareArrival}
        onFinish={onFinish}
        solicitudes={solicitudes}
        selectedSolicitud={selectedSolicitud}
        selectedCanRespond={selectedCanRespond}
        selectedBlockReason={selectedBlockReason}
        selectedOutcome={selectedOutcome}
        selectedDistanceKm={selectedDistanceKm}
        onSelectSolicitud={onSelectSolicitud}
        onAcceptSelected={onAcceptSelected}
        onRejectSelected={onRejectSelected}
        onViewSelected={onViewSelected}
        onCloseSelected={onCloseSelected}
      />
      <AidCentersPanel centros={centros} />
    </aside>
  );
}
