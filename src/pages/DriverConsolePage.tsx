import { Check, Radio } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CitizenSummaryChips } from '@/features/ciudadano/CitizenSummaryChips';
import { formatCoordinates } from '@/features/ciudadano/citizen-request';
import {
  CITIZEN_FALLBACK_POSITION,
  countCentersByLevel,
  formatDistance,
} from '@/features/ciudadano/citizen-view';
import { DriverRail } from '@/features/conductor/DriverRail';
import { useDriverAlertsStore } from '@/features/conductor/driver-alerts-store';
import { resolveDriverAmbulanceId } from '@/features/conductor/driver-session';
import { DRIVER_STATUS_META, type DriverStatus } from '@/features/conductor/driver-status';
import { useSolicitudInbox } from '@/features/conductor/use-solicitud-inbox';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useEmergencySync } from '@/features/emergencias/use-emergency-sync';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useFleetSync } from '@/features/flota/use-fleet-sync';
import { useDeviceLocation } from '@/features/geolocalizacion/use-device-location';
import {
  MapCanvas,
  type RequestConnector,
  type RequestMarker,
  type SelfMarker,
} from '@/features/mapa/MapCanvas';
import { useSessionStore } from '@/features/usuarios/session';
import { distanceKm, etaMinutes } from '@/lib/geo';
import { MOCK_AMBULANCIAS, MOCK_CENTROS_AYUDA, MOCK_EMERGENCIAS } from '@/mocks/fixtures';
import {
  DESTINATIONS,
  getRealtimePort,
  type LiveUnitPayload,
  type RealtimePort,
} from '@/shared/realtime';
import type { Ambulancia, CentroAyuda } from '@/types/domain';

/** Stable empty list so the map props do not change identity every render. */
const NO_NOTIFIED_UNITS: readonly string[] = [];

interface DriverConsolePageProps {
  /** Injectable for tests; defaults to the app realtime port. */
  port?: RealtimePort | null;
  /** The unit this driver drives; defaults to the mock session mapping. */
  ambulanceId?: string;
  /** Fleet to hydrate; injectable for tests. */
  ambulancias?: Ambulancia[];
  /** Aid centers drawn on the map and listed in the rail. */
  centrosAyuda?: CentroAyuda[];
}

/**
 * Driver console: header with the live center counts, the emergency map centered
 * on the driver, and the rail (own unit, request inbox, nearby aid centers),
 * mirroring the citizen screen's layout.
 *
 * The "Tu ambulancia" panel now owns every control the Uber-style bottom sheet
 * used to mount (connection, the four driver states, the mission and the
 * simulation fallback), so the sheet is gone and nothing overlaps the rail.
 *
 * Without a device position the map falls back to the citizen fallback, so both
 * screens frame the same area instead of showing two different backdrops.
 *
 * C2: Accept is a BID. This screen never decides a winner; it publishes the
 * accept and renders whatever the server-side arbiter answers.
 */
export default function DriverConsolePage({
  port = getRealtimePort(),
  ambulanceId,
  ambulancias = MOCK_AMBULANCIAS,
  centrosAyuda = MOCK_CENTROS_AYUDA,
}: DriverConsolePageProps) {
  const userId = useSessionStore((state) => state.user?.id);
  const unitId = ambulanceId ?? resolveDriverAmbulanceId(userId);

  const location = useDeviceLocation();
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState<DriverStatus>('OFF_DUTY');
  const [hasCentered, setHasCentered] = useState(false);

  // Shared stores: emergencies reported and units created on another client
  // show up on the driver map too (UPSERT semantics).
  useEffect(() => {
    useFleetStore.getState().hydrate(ambulancias);
  }, [ambulancias]);
  useEffect(() => {
    useEmergencyStore.getState().hydrate(MOCK_EMERGENCIAS);
  }, []);
  useFleetSync(port);
  useEmergencySync(port);

  const fleetUnits = useFleetStore((state) => state.units);
  const emergencies = useEmergencyStore((state) => state.items);

  // The rail reads the driver's own unit straight from the store (the self marker
  // stands in for it on the map, so `fleet` below excludes it).
  const ownUnit = useMemo(
    () => fleetUnits.find((unit) => unit.id === unitId) ?? null,
    [fleetUnits, unitId],
  );

  /*
    RAD-3: without a GPS fix the driver still has a declared position — the one
    the fleet data gives their own unit. Use it as the origin for distances, the
    connector and the self marker, and report it as SIMULATED through the app's
    existing `simulated` flag: the self marker gets `nv-marker--sim` and the
    /topic/flota payload carries `source: 'simulated'`. With no unit either,
    `effectivePosition` stays null and the UI keeps its honest "Sin ubicación".
  */
  const fallbackToUnit = location.position === null && ownUnit !== null;
  const effectivePosition = location.position ?? ownUnit?.ubicacion ?? null;
  const effectiveSimulated = location.simulated || fallbackToUnit;

  const inbox = useSolicitudInbox(port, unitId, effectivePosition);

  const requestOpen = inbox.phase === 'idle' || inbox.phase === 'submitting';
  // `C.d4`: an open mission owns the rail and the map, unless a new request is
  // actually waiting for an answer (phase idle/submitting).
  const missionActive = inbox.mission !== null && !requestOpen;

  useEffect(() => {
    if (!hasCentered && effectivePosition) {
      setHasCentered(true);
    }
  }, [hasCentered, effectivePosition]);

  // Report this unit on /topic/flota while online so the CRUE map tracks it. A
  // live mission reports the unit as ASSIGNED regardless of the declared status,
  // so finishing the service really flips it back to AVAILABLE on the wire.
  const { heading } = location;
  useEffect(() => {
    if (!online || !port || !effectivePosition) {
      return;
    }
    const payload: LiveUnitPayload = {
      ambulanceId: unitId,
      ubicacion: effectivePosition,
      estado: missionActive ? 'ASSIGNED' : DRIVER_STATUS_META[status].estado,
      heading,
      source: effectiveSimulated ? 'simulated' : 'device',
    };
    port.publish(DESTINATIONS.flota, payload);
  }, [online, port, unitId, effectivePosition, heading, effectiveSimulated, status, missionActive]);

  const goOnline = useCallback(() => {
    setOnline(true);
    setStatus((current) => (current === 'OFF_DUTY' ? 'AVAILABLE' : current));
  }, []);

  const goOffline = useCallback(() => {
    setOnline(false);
    setStatus('OFF_DUTY');
  }, []);

  // "Finalizar servicio": the mission ends locally and the unit is declared
  // available again, so the /topic/flota effect republishes it as AVAILABLE and
  // the rail drops back to the operations map.
  const finishService = useCallback(() => {
    inbox.finishService();
    setStatus('AVAILABLE');
  }, [inbox.finishService]);

  const fleet = useMemo(
    () => fleetUnits.filter((unit) => unit.id !== unitId),
    [fleetUnits, unitId],
  );
  const counts = useMemo(() => countCentersByLevel(centrosAyuda), [centrosAyuda]);

  const self: SelfMarker | null = useMemo(
    () =>
      effectivePosition
        ? {
            position: effectivePosition,
            simulated: effectiveSimulated,
            label: `Tú · ${unitId}`,
          }
        : null,
    [effectivePosition, effectiveSimulated, unitId],
  );

  const activeScene = (missionActive ? inbox.mission : inbox.broadcast)?.escena ?? null;
  const requestDistance =
    activeScene && effectivePosition ? distanceKm(effectivePosition, activeScene) : null;
  const requestEta =
    activeScene && effectivePosition ? etaMinutes(effectivePosition, activeScene) : null;

  // The shell bell mirrors the pending request count. The driver console is the
  // only writer; it resets to zero when the page unmounts. A won mission is not
  // a pending request, so the bell drops with the card it mirrored.
  const pendingRequests = inbox.broadcast && !missionActive ? 1 : 0;
  useEffect(() => {
    const { setPendingRequests } = useDriverAlertsStore.getState();
    setPendingRequests(pendingRequests);
    return () => setPendingRequests(0);
  }, [pendingRequests]);

  // The request has no reverse geocoding: the label is the declared zone, or the
  // real reported coordinates when the citizen declared none.
  const sceneLabel = activeScene
    ? (missionActive ? inbox.mission?.zonaId : inbox.broadcast?.zonaId) ||
      formatCoordinates(activeScene)
    : '';

  const requestMarker: RequestMarker | null = useMemo(
    () =>
      activeScene
        ? {
            position: activeScene,
            label:
              requestDistance !== null
                ? `${sceneLabel} · ${formatDistance(requestDistance)}`
                : sceneLabel,
          }
        : null,
    [activeScene, sceneLabel, requestDistance],
  );

  // A straight visual connector, NOT a calculated route: no routing engine. A
  // live mission draws it solid (`C.d4`); a pending request keeps it dashed.
  const requestConnector: RequestConnector | null = useMemo(
    () =>
      activeScene && effectivePosition
        ? { from: effectivePosition, to: activeScene, dashed: !missionActive }
        : null,
    [activeScene, effectivePosition, missionActive],
  );

  const missionLocation =
    inbox.mission && (inbox.mission.zonaId || formatCoordinates(inbox.mission.escena));

  const toastText = `Nueva solicitud de ambulancia${
    requestDistance !== null ? ` a ${formatDistance(requestDistance)}` : ''
  }`;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto bg-nv-mint text-nv-navy lg:grid lg:grid-cols-[minmax(0,1fr)_344px] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-5 lg:overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 lg:col-span-2">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            {missionActive
              ? inbox.missionPhase === 'en_route'
                ? 'En camino al ciudadano'
                : 'Llegaste al destino'
              : 'Mapa de operación'}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-nv-navy-400 text-sm">
            <span
              className="size-2 shrink-0 rounded-full bg-nv-teal shadow-[0_0_0_3px_rgb(93_186_168_/_0.28)]"
              aria-hidden
            />
            Suba, Bogotá · en vivo
          </p>
        </div>
        <CitizenSummaryChips counts={counts} />
      </header>

      <section
        aria-label="Mapa del conductor"
        className="relative h-[52dvh] min-h-[300px] shrink-0 overflow-hidden rounded-nv-lg shadow-nv-card lg:h-auto lg:min-h-0"
      >
        <MapCanvas
          ambulancias={fleet}
          emergencias={emergencies}
          centros={centrosAyuda}
          center={effectivePosition ?? CITIZEN_FALLBACK_POSITION}
          focus={hasCentered ? null : effectivePosition}
          self={self}
          request={requestMarker}
          requestConnector={requestConnector}
          notifiedAmbulanceIds={
            missionActive ? NO_NOTIFIED_UNITS : (inbox.broadcast?.notificadas ?? NO_NOTIFIED_UNITS)
          }
          onMapClick={effectiveSimulated ? location.setSimulatedPosition : undefined}
          onSelfDragEnd={effectiveSimulated ? location.setSimulatedPosition : undefined}
          onSelectAmbulance={() => undefined}
          onSelectEmergency={() => undefined}
        />

        {inbox.broadcast && requestOpen && (
          <div className="pointer-events-none absolute inset-x-0 top-5 z-[1000] flex justify-center px-3">
            <div className="flex items-center gap-2.5 whitespace-nowrap rounded-nv-md bg-nv-navy px-4 py-3 font-medium text-sm text-white shadow-nv-float">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-nv-lime text-nv-navy">
                <Radio className="size-4" aria-hidden />
              </span>
              {toastText}
            </div>
          </div>
        )}

        {/* Only once the citizen confirmed: the toast never announces a step
            that has not happened (`C.d5`). */}
        {missionActive && inbox.mission?.confirmedAt != null && (
          <div className="pointer-events-none absolute inset-x-0 top-5 z-[1000] flex justify-center px-3">
            <div className="flex items-center gap-2.5 whitespace-nowrap rounded-nv-md bg-nv-navy px-4 py-3 font-medium text-sm text-white shadow-nv-float">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-nv-lime text-nv-navy">
                <Check className="size-4" aria-hidden />
              </span>
              El ciudadano confirmó que llegaste
            </div>
          </div>
        )}
      </section>

      <DriverRail
        unitId={unitId}
        unit={ownUnit}
        status={status}
        online={online}
        onStatusChange={setStatus}
        onGoOnline={goOnline}
        onGoOffline={goOffline}
        mission={inbox.mission}
        missionDistanceKm={missionActive ? requestDistance : null}
        missionEtaMin={missionActive ? requestEta : null}
        missionLocation={missionLocation ?? ''}
        missionPhase={inbox.missionPhase}
        missionAcceptedAt={inbox.mission?.acceptedAt ?? null}
        missionArrivedAt={inbox.mission?.arrivedAt ?? null}
        missionConfirmedAt={inbox.mission?.confirmedAt ?? null}
        onDeclareArrival={inbox.declareArrival}
        onFinish={finishService}
        location={location}
        request={{
          broadcast: inbox.broadcast,
          phase: inbox.phase,
          outcomeMessage: inbox.outcomeMessage,
          deadlineMs: inbox.deadlineMs,
          windowMs: inbox.windowMs,
          distanceKm: requestDistance,
          etaMin: requestEta,
          requestedAtMs: inbox.requestedAtMs,
          unitId,
          onAccept: inbox.accept,
          onReject: inbox.reject,
          onTimeout: inbox.notifyTimeout,
        }}
        centros={centrosAyuda}
      />
    </div>
  );
}
