import type { LucideIcon } from 'lucide-react';
import {
  Ambulance,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
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
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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
import {
  LocationSimulationControls,
  SIMULATION_ENABLED,
} from '@/features/geolocalizacion/LocationSimulationControls';
import type { DeviceLocationState } from '@/features/geolocalizacion/use-device-location';
import { unitPlateLabel } from '@/features/seguimiento/tracking';
import {
  EMERGENCY_LEVEL_META,
  REQUEST_STATE_LABEL_ES,
} from '@/features/solicitudes/request-status';
import { useClock } from '@/hooks/use-clock';
import { formatCountdown, formatElapsed } from '@/lib/format';
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
  isSoundMuted,
  isSoundSupported,
  isSoundUnlocked,
  setSoundMuted,
  subscribeSoundStatus,
  unlockSound,
} from './request-sound';
import { REJECTED_BY_UNIT_LABEL, rejectedByUnit } from './solicitud-response';
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
 * no triage behind it) shows NO chip: a label that only says what is missing is
 * noise on a card the driver reads in seconds, and no severity is invented. The
 * colour comes from the shared `EMERGENCY_LEVEL_META` table.
 */
function LevelChip({ level, className }: { level?: EmergencyLevel; className?: string }) {
  if (!level) {
    return null;
  }
  const meta = EMERGENCY_LEVEL_META[level];
  return (
    <span
      className={cn(
        'shrink-0 rounded-nv-pill border px-2.5 py-1 font-semibold text-xs',
        meta.borderClass,
        meta.textClass,
        className,
      )}
    >
      {meta.label}
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
  statusLocked,
  onGoOnline,
  onGoOffline,
  connectionPending,
  disconnectBlockedReason,
  mission,
  location,
}: {
  unitId: string;
  unit: Ambulancia | null;
  status: DriverStatus;
  online: boolean;
  onStatusChange: (status: DriverStatus) => void;
  /** Disconnected or attending a request: the declared state cannot change now. */
  statusLocked: boolean;
  onGoOnline: () => void;
  onGoOffline: () => void;
  /** A connect/disconnect command is in flight: both buttons wait for the server. */
  connectionPending: boolean;
  /** Why the driver cannot disconnect right now; null when they can. */
  disconnectBlockedReason: string | null;
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
            disabled={connectionPending || disconnectBlockedReason !== null}
            title={disconnectBlockedReason ?? undefined}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-nv-md border-[1.5px] border-nv-line bg-white px-4 font-semibold text-nv-navy text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Power className="size-4" aria-hidden />
            Desconectarse
          </button>
        ) : (
          <button
            type="button"
            onClick={onGoOnline}
            disabled={connectionPending}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-nv-md bg-nv-navy px-4 font-semibold text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Power className="size-4" aria-hidden />
            Conectarse
          </button>
        )}
        {/* The reason is written out, not only a tooltip: a disabled button with
            no explanation reads as broken. */}
        {online && disconnectBlockedReason !== null && (
          <p className="text-nv-navy-400 text-xs">{disconnectBlockedReason}</p>
        )}
        {/* Connected is not enough to receive a request: the server also needs
            the unit to have signal (EP-04.F2.US1). A connected driver whose
            unit lost it would wait for requests that can never arrive, so the
            console says what is missing and how to fix it. */}
        {online && unit?.sinSenal === true && (
          <p role="status" className="text-critical text-xs">
            Tu ambulancia está sin señal y no recibirá solicitudes. Activa tu ubicación
            {SIMULATION_ENABLED ? ' o pulsa «Simular posición».' : '.'}
          </p>
        )}
      </div>

      {/*
        The four driver states, marked with aria-pressed. Only "Disponible" and
        "Fuera de servicio" are declared by the driver. "En ruta" and "En escena"
        follow the accepted request (accepting it, declaring the arrival), so
        they are never pressed by hand: a state the driver could choose freely
        could contradict the mission, and the server would still send requests.
        A state that cannot be chosen now is disabled; the current one keeps its
        full colour so it still reads as the answer.
      */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="nv-label text-nv-navy-400">Mi estado</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {DRIVER_STATUS_ORDER.map((value) => {
            const valueMeta = DRIVER_STATUS_META[value];
            const active = status === value;
            const declarable = value === 'AVAILABLE' || value === 'OFF_DUTY';
            const disabled = !declarable || statusLocked || connectionPending;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => onStatusChange(value)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-nv-md border-[1.5px] px-3 py-2 text-left font-semibold text-xs disabled:cursor-not-allowed',
                  active
                    ? 'border-nv-navy bg-nv-navy text-white'
                    : 'border-nv-line bg-white text-nv-navy disabled:opacity-60',
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

      {SIMULATION_ENABLED && (
        <div className="flex flex-col gap-2 rounded-nv-md border border-nv-line p-3">
          <LocationSimulationControls
            location={location}
            note="Toca el mapa o arrastra el marcador SIM para moverte."
          />
        </div>
      )}
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
 * Sound control. The sound is ON by default and unlocks itself with the first
 * click on the page; this control shows the real state and lets the driver
 * silence it or bring it back. It never claims the sound is active when it is
 * not: while the browser still blocks the audio it offers "Activar sonido", and
 * a browser without Web Audio says so instead of showing a dead button.
 */
function SoundToggle() {
  const supported = isSoundSupported();
  const unlocked = useSyncExternalStore(subscribeSoundStatus, isSoundUnlocked, () => false);
  const muted = useSyncExternalStore(subscribeSoundStatus, isSoundMuted, () => false);

  if (!supported) {
    return (
      <span className="shrink-0 rounded-nv-pill bg-idle/15 px-2.5 py-1 font-medium text-idle text-xs">
        Sonido no disponible
      </span>
    );
  }
  if (muted) {
    return (
      <button
        type="button"
        onClick={() => {
          setSoundMuted(false);
          void unlockSound();
        }}
        aria-pressed={false}
        title="Activar el sonido de las solicitudes"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-nv-pill border-[1.5px] border-nv-line bg-white px-2.5 py-1 font-semibold text-nv-navy text-xs"
      >
        <VolumeX className="size-3.5" aria-hidden />
        Sonido silenciado
      </button>
    );
  }
  if (unlocked) {
    return (
      <button
        type="button"
        onClick={() => setSoundMuted(true)}
        aria-pressed={true}
        title="Silenciar el sonido de las solicitudes"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-nv-pill bg-nv-lime px-2.5 py-1 font-semibold text-nv-navy text-xs"
      >
        <Volume2 className="size-3.5" aria-hidden />
        Sonido activado
      </button>
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

/** DOM id of the open request card, so the pop-up's "Ver solicitud" can reach it. */
export const REQUEST_CARD_ID = 'solicitud-abierta';
/** DOM id of the opened registry detail, so the pop-up can bring it into view. */
export const SOLICITUD_DETAIL_ID = 'solicitud-detalle';

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

  const emergencyLabel = [broadcast.emergenciaId, broadcast.tipo].filter(Boolean).join(' · ');

  const hint =
    broadcast.mode === 'direct'
      ? `Solicitud dirigida solo a tu unidad. Si no respondes en ${windowSeconds} s, deja de mostrarse aquí.`
      : others.length > 0
        ? `También se avisó a ${unitListLabel(others, units)}. La solicitud es de quien acepte primero; si no respondes en ${windowSeconds} s, deja de mostrarse aquí.`
        : `La solicitud es de quien acepte primero; si no respondes en ${windowSeconds} s, deja de mostrarse aquí.`;

  return (
    <section
      id={REQUEST_CARD_ID}
      aria-label="Solicitud de ambulancia"
      className="flex scroll-mt-4 flex-col gap-3.5 rounded-nv-lg border-nv-red-600 border-t-[5px] bg-white p-4 shadow-nv-card"
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
          type (`EMG-002 · Traffic collision`). A citizen request points at no
          emergency, and then the row is left out: a row that only says what is
          missing is noise.
        */}
        {emergencyLabel && <RequestDataRow label="Emergencia" value={emergencyLabel} icon={User} />}
        {/* A citizen request declares no zone, so the coordinates it really
            reported (`escena`) are shown instead of an empty zone slot. A CRUE
            request keeps its declared zone. A backend frame may carry neither,
            and then the row says so instead of inventing a location. */}
        {broadcast.solicitanteNombre && (
          <RequestDataRow label="Solicitante" value={broadcast.solicitanteNombre} icon={User} />
        )}
        <RequestDataRow
          label="Ubicación"
          value={
            broadcast.direccion ||
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
    solicitud.direccion ||
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
  rejected,
  onSelect,
}: {
  solicitud: SolicitudAmbulancia;
  selected: boolean;
  /** This unit declined the request: it is still listed, but not answerable. */
  rejected: boolean;
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
            {rejected ? REJECTED_BY_UNIT_LABEL : REQUEST_STATE_LABEL_ES[solicitud.estado]}
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
 * notified units) and its two actions; the row itself folds it back.
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
  rejected,
  blockReason,
  outcome,
  notice,
  onAccept,
  onReject,
  onClose,
}: {
  solicitud: SolicitudAmbulancia;
  distanceKm: number | null;
  units: readonly Ambulancia[];
  canRespond: boolean;
  /** This unit declined the request: it reads as such, like its registry row. */
  rejected: boolean;
  /** Honest reason the actions are disabled; null while the row is respondible. */
  blockReason: string | null;
  /** Server's answer to this row's last response, or null. */
  outcome: SolicitudResponseOutcome | null;
  /** Said when the server's detail could not be read; null otherwise. */
  notice: string | null;
  onAccept: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const notified = solicitud.ambulanciasNotificadas;
  return (
    <div
      id={SOLICITUD_DETAIL_ID}
      data-testid="solicitud-detail"
      className="flex flex-col gap-3 rounded-nv-md border border-nv-line bg-white p-3.5"
    >
      <div className="flex items-center gap-2">
        <h5 className="min-w-0 flex-1 truncate font-semibold text-sm">
          {solicitudLabel(solicitud)}
        </h5>
        <span className="shrink-0 rounded-nv-pill bg-nv-mint px-2 py-0.5 font-medium text-nv-navy-400 text-[11px]">
          {rejected ? REJECTED_BY_UNIT_LABEL : REQUEST_STATE_LABEL_ES[solicitud.estado]}
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
        {/* A citizen request has no emergency and no type behind it: the two
            rows appear only when there is something to say. */}
        {solicitud.emergenciaId && (
          <RequestDataRow label="Emergencia" value={solicitud.emergenciaId} icon={User} />
        )}
        {solicitud.tipo && <RequestDataRow label="Tipo" value={solicitud.tipo} icon={Info} />}
        {solicitud.solicitanteNombre && (
          <RequestDataRow label="Solicitante" value={solicitud.solicitanteNombre} icon={User} />
        )}
        {/* A citizen request declares no zone; its own reported coordinates are
            the honest location, never an invented zone. */}
        <RequestDataRow label="Ubicación" value={solicitudSceneLabel(solicitud)} icon={MapPin} />
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
      </div>

      {notice && (
        <p role="status" className="text-nv-navy-400 text-xs leading-[18px]">
          {notice}
        </p>
      )}

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
  selectedNotice,
  selectedDistanceKm,
  onSelectSolicitud,
  onAcceptSelected,
  onRejectSelected,
  onCloseSelected,
  offDuty,
  ...request
}: RequestPanelProps &
  MissionPanelProps & {
    /** Whether the driver is receiving requests; otherwise the offer surface is hidden. */
    online: boolean;
    /**
     * Connected but declared "Fuera de servicio": the surface is hidden for that
     * reason, and the empty state says so instead of asking to connect.
     */
    offDuty: boolean;
    mission: Mission | null;
    units: readonly Ambulancia[];
    solicitudes: SolicitudAmbulancia[];
    selectedSolicitud: SolicitudAmbulancia | null;
    selectedCanRespond: boolean;
    /** Honest reason the selected row's actions are disabled, when they are. */
    selectedBlockReason: string | null;
    /** Server's answer to the selected row's last response, or null. */
    selectedOutcome: SolicitudResponseOutcome | null;
    /** Said when the server's detail of the selected row could not be read. */
    selectedNotice: string | null;
    selectedDistanceKm: number | null;
    onSelectSolicitud: (solicitud: SolicitudAmbulancia) => void;
    onAcceptSelected: () => void;
    onRejectSelected: () => void;
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
          <b className="font-semibold text-sm">
            {offDuty
              ? 'Marca «Disponible» para recibir solicitudes'
              : 'Conéctate para recibir solicitudes'}
          </b>
          <span className="text-nv-navy-400 text-xs leading-[18px]">
            {offDuty
              ? 'Mientras estés fuera de servicio no verás solicitudes de ambulancia ni podrás aceptarlas.'
              : 'Mientras estés desconectado no verás solicitudes de ambulancia ni podrás aceptarlas.'}
          </span>
        </div>
      ) : request.broadcast ? (
        <RequestCard {...request} units={units} broadcast={request.broadcast} />
      ) : hasRegistry ? null : (
        <div className="flex flex-col items-center gap-1.5 rounded-nv-md border border-dashed border-nv-line px-4 py-6 text-center">
          <Radio className="size-6 text-nv-teal" aria-hidden />
          <b className="font-semibold text-sm">Sin solicitudes por ahora</b>
          <span className="text-nv-navy-400 text-xs leading-[18px]">
            Cuando alguien pida una ambulancia te avisaremos en pantalla, con sonido.
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
                rejected={
                  solicitud.estado === 'PENDING' && rejectedByUnit(solicitud, request.unitId)
                }
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
          rejected={solicitudes.some(
            (solicitud) =>
              solicitud.id === selectedSolicitud.id &&
              solicitud.estado === 'PENDING' &&
              rejectedByUnit(solicitud, request.unitId),
          )}
          blockReason={selectedBlockReason}
          outcome={selectedOutcome}
          notice={selectedNotice}
          onAccept={onAcceptSelected}
          onReject={onRejectSelected}
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
  /** Disconnected or attending a request: the declared state cannot change now. */
  statusLocked?: boolean;
  /** Connected but declared "Fuera de servicio": no request is surfaced. */
  offDuty?: boolean;
  onGoOnline: () => void;
  onGoOffline: () => void;
  /** A connect/disconnect command is in flight against the backend. */
  connectionPending?: boolean;
  /** Why the driver cannot disconnect right now; null or absent when they can. */
  disconnectBlockedReason?: string | null;
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
  /** Said when the server's detail of the selected row could not be read; null otherwise. */
  selectedNotice: string | null;
  /** Distance to the selected row's scene, or null without a resolvable scene. */
  selectedDistanceKm: number | null;
  /** Selects a row: expands its detail and centres the map on it. */
  onSelectSolicitud: (solicitud: SolicitudAmbulancia) => void;
  /** Answers the selected row (by its id) with an accept. */
  onAcceptSelected: () => void;
  /** Answers the selected row (by its id) with a reject. */
  onRejectSelected: () => void;
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
  statusLocked = false,
  offDuty = false,
  onGoOnline,
  onGoOffline,
  connectionPending = false,
  disconnectBlockedReason = null,
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
  selectedNotice,
  selectedDistanceKm,
  onSelectSolicitud,
  onAcceptSelected,
  onRejectSelected,
  onCloseSelected,
}: DriverRailProps) {
  // `units` is the REST of the fleet (the self marker stands in for the own unit
  // on the map), but the notified list of a request includes this unit too. The
  // own unit is added here so its id resolves to its plate like any other,
  // instead of being printed as the internal id.
  const unitsWithOwn = useMemo(() => (unit ? [unit, ...units] : units), [unit, units]);
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
        statusLocked={statusLocked}
        onGoOnline={onGoOnline}
        onGoOffline={onGoOffline}
        connectionPending={connectionPending}
        disconnectBlockedReason={disconnectBlockedReason}
        mission={mission}
        location={location}
      />
      <SolicitudesPanel
        {...request}
        online={online && !offDuty}
        offDuty={online && offDuty}
        units={unitsWithOwn}
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
        selectedNotice={selectedNotice}
        selectedDistanceKm={selectedDistanceKm}
        onSelectSolicitud={onSelectSolicitud}
        onAcceptSelected={onAcceptSelected}
        onRejectSelected={onRejectSelected}
        onCloseSelected={onCloseSelected}
      />
      <AidCentersPanel centros={centros} />
    </aside>
  );
}
