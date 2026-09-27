import { Check } from 'lucide-react';
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
import { SolicitudSheet } from '@/features/conductor/SolicitudSheet';
import { useSolicitudInbox } from '@/features/conductor/use-solicitud-inbox';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useEmergencySync } from '@/features/emergencias/use-emergency-sync';
import { fetchFlota, fetchMiAmbulancia } from '@/features/flota/fleet-api';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useFleetSync } from '@/features/flota/use-fleet-sync';
import { LocationPermissionDialog } from '@/features/geolocalizacion/LocationPermissionDialog';
import { useDeviceLocation } from '@/features/geolocalizacion/use-device-location';
import {
  MapCanvas,
  type RequestConnector,
  type RequestMarker,
  type SelfMarker,
} from '@/features/mapa/MapCanvas';
import {
  applyMapFilter,
  type MapFilterState,
  readPersistedMapFilter,
} from '@/features/mapa/map-filter';
import { useMapData } from '@/features/mapa/use-map-data';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { useSolicitudRegistrySync } from '@/features/solicitudes/use-solicitud-registry-sync';
import { useSessionStore } from '@/features/usuarios/session';
import { useRuta } from '@/hooks/use-ruta';
import { distanceKm, etaMinutes } from '@/lib/geo';
import {
  MOCK_AMBULANCIAS,
  MOCK_CENTROS_AYUDA,
  MOCK_EMERGENCIAS,
  MOCK_SOLICITUDES,
} from '@/mocks/fixtures';
import { isDemoMode } from '@/services/apiClient';
import {
  DESTINATIONS,
  getRealtimePort,
  type LiveUnitPayload,
  type RealtimePort,
} from '@/shared/realtime';
import type { Ambulancia, CentroAyuda, SolicitudAmbulancia, Ubicacion } from '@/types/domain';

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
  /** Requests hydrated into the registry and listed at the bottom. */
  solicitudes?: SolicitudAmbulancia[];
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
  solicitudes = MOCK_SOLICITUDES,
}: DriverConsolePageProps) {
  const userId = useSessionStore((state) => state.user?.id);
  /**
   * The driver's OWN unit. An explicit `ambulanceId` prop (tests, demo) wins; in
   * demo mode the mock session mapping resolves it; against a real backend the
   * unit comes from the server-scoped `GET /flota/ambulancias/mia` (FIX3),
   * because the general fleet list no longer exposes any driver id. Until that
   * read lands there is no unit yet, so the map/rail degrade honestly and the
   * inbox refuses to accept/reject on an unresolved unit (FIX B) instead of
   * sending an empty id.
   */
  const [serverUnitId, setServerUnitId] = useState<string | null>(null);
  const demo = isDemoMode();
  const unitId = ambulanceId ?? (demo ? resolveDriverAmbulanceId(userId) : (serverUnitId ?? ''));
  /** Off-demo the unit comes from the server: an empty id means "not resolved". */
  const unitResolved = unitId !== '';

  const location = useDeviceLocation();
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState<DriverStatus>('OFF_DUTY');
  const [hasCentered, setHasCentered] = useState(false);
  const [selectedSolicitud, setSelectedSolicitud] = useState<SolicitudAmbulancia | null>(null);
  const [mapFocus, setMapFocus] = useState<Ubicacion | null>(null);

  // Shared stores: emergencies reported and units created on another client
  // show up on the driver map too (UPSERT semantics).
  useEffect(() => {
    useFleetStore.getState().hydrate(ambulancias);
  }, [ambulancias]);
  // Real backend: read the fleet so the driver's map shows the other units, and
  // read the driver's OWN unit from the server-scoped `/mia` resource. The
  // fixtures are never substituted on error: a failed read leaves the unit
  // unresolved and the UI says so.
  useEffect(() => {
    if (demo || ambulanceId !== undefined) {
      return;
    }
    let active = true;
    fetchFlota()
      .then((unidades) => {
        if (active) {
          useFleetStore.getState().hydrate(unidades);
        }
      })
      .catch(() => {
        // The map's fleet feed is optional here: the own-unit read below is what
        // the driver needs, so a fleet read failure never blocks it.
      });
    fetchMiAmbulancia()
      .then((mia) => {
        if (active) {
          setServerUnitId(mia?.id ?? null);
        }
      })
      .catch(() => {
        if (active) {
          setServerUnitId(null);
        }
      });
    return () => {
      active = false;
    };
  }, [demo, ambulanceId]);
  useEffect(() => {
    useEmergencyStore.getState().hydrate(MOCK_EMERGENCIAS);
  }, []);
  // The request registry (U5) is the same multi-request store the CRUE uses: the
  // fixtures seed it and the realtime sync UPSERTs every arriving request.
  useEffect(() => {
    useSolicitudesStore.getState().hydrate(solicitudes);
  }, [solicitudes]);
  useFleetSync(port);
  useEmergencySync(port);
  useSolicitudRegistrySync(port);

  const fleetUnits = useFleetStore((state) => state.units);
  const emergencies = useEmergencyStore((state) => state.items);
  const solicitudesRegistry = useSolicitudesStore((state) => state.items);
  // Zones and centers come from the shared map source: the fixtures with the
  // demo flag on, `GET /api/v1/mapa` with it off (never a silent fallback).
  const mapa = useMapData(centrosAyuda);

  // U2b: the "Zonas" LAYER filter is the only switch that paints zones. Selection
  // never does. The choice is read once from the same persisted shape the citizen
  // map writes, and applied ONLY to the props the map receives, so a zone hidden
  // here stays in the source ready to paint the moment the layer is back on.
  const [mapFilter] = useState<MapFilterState>(readPersistedMapFilter);
  const visibleMapLayers = useMemo(
    () => applyMapFilter(mapFilter, { zonas: mapa.zonas, centros: mapa.centros, ambulancias: [] }),
    [mapFilter, mapa.zonas, mapa.centros],
  );

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

  // U6: the tapped request is actionable only while it is the inbox's open
  // broadcast AND the driver's own unit is resolved. The accept/reject actions
  // send `ambulanciaId`, so without a resolved unit they must stay disabled
  // (FIX B) instead of firing an empty id.
  const selectedIsActive =
    unitResolved &&
    selectedSolicitud !== null &&
    inbox.broadcast?.requestId === selectedSolicitud.id &&
    requestOpen;

  const handleSelectSolicitud = useCallback((solicitud: SolicitudAmbulancia) => {
    setSelectedSolicitud(solicitud);
  }, []);

  const handleAcceptFromSheet = useCallback(() => {
    inbox.accept();
    setSelectedSolicitud(null);
  }, [inbox.accept]);

  const handleRejectFromSheet = useCallback(() => {
    // Only the open request is actionable: any other row must not fire a reject
    // for a mission the inbox is not offering. Returning false lets the sheet
    // stay open with its honest reason.
    if (!selectedIsActive) {
      return false;
    }
    inbox.reject();
    setSelectedSolicitud(null);
    return true;
  }, [selectedIsActive, inbox.reject]);

  // U7 "Visualizar": close the sheet and centre the map on the requester. The
  // scene comes from the active broadcast when it is the open request, and from
  // the emergency store otherwise; the last resort is the request's own location
  // in the registry (the map source already knows the centers/zones by id). With
  // none of them the map stays put instead of flying to an invented point.
  const handleViewSolicitud = useCallback(() => {
    const solicitud = selectedSolicitud;
    setSelectedSolicitud(null);
    if (!solicitud) {
      return;
    }
    const emergency = emergencies.find((item) => item.id === solicitud.emergenciaId) ?? null;
    const centro = mapa.centros.find((item) => item.id === solicitud.centroAyudaId) ?? null;
    // A backend wire frame declares the zone, not coordinates: those come from
    // the emergency or the (real) aid center, both resolved by id.
    const zone = solicitud.zonaId
      ? mapa.centros.find((item) => item.zonaId === solicitud.zonaId)?.ubicacion
      : undefined;
    const scene =
      (inbox.broadcast?.requestId === solicitud.id ? inbox.broadcast?.escena : undefined) ??
      emergency?.ubicacion ??
      centro?.ubicacion ??
      zone ??
      null;
    if (scene) {
      // A fresh object so a repeated "Visualizar" re-flies even to the same point.
      setMapFocus({ lat: scene.lat, lng: scene.lng });
    }
  }, [selectedSolicitud, emergencies, inbox.broadcast, mapa.centros]);

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
  const counts = useMemo(() => countCentersByLevel(mapa.centros), [mapa.centros]);

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
  // Straight-line estimate: the honest fallback while no route is available (AC3).
  const straightLineEta =
    activeScene && effectivePosition ? etaMinutes(effectivePosition, activeScene) : null;

  // Real street routing (OSRM), the same hook the citizen page uses, from the
  // driver's own position (`effectivePosition`) to the citizen's scene
  // (`activeScene`). It returns null until a route resolves and on any failure
  // (timeout, error, demo mode without coordinates), so the map and the ETA fall
  // back to today's straight-line behaviour (AC3).
  const ruta = useRuta(effectivePosition, activeScene);
  // The REAL routed duration in whole minutes, or null when there is no route.
  const routeEtaMin = ruta ? Math.max(1, Math.round(ruta.duracionMin)) : null;
  // The driver reads the routed time when it exists and the straight-line
  // estimate otherwise: never a routed time that does not exist.
  const requestEta = routeEtaMin ?? straightLineEta;

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

  const missionLocation = inbox.mission
    ? inbox.mission.zonaId || (inbox.mission.escena ? formatCoordinates(inbox.mission.escena) : '')
    : '';

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
          centros={mapa.centros}
          zonas={visibleMapLayers.zonas}
          center={effectivePosition ?? CITIZEN_FALLBACK_POSITION}
          focus={mapFocus ?? (hasCentered ? null : effectivePosition)}
          onFocusApplied={() => setMapFocus(null)}
          self={self}
          request={requestMarker}
          requestConnector={requestConnector}
          ruta={ruta}
          notifiedAmbulanceIds={
            missionActive ? NO_NOTIFIED_UNITS : (inbox.broadcast?.notificadas ?? NO_NOTIFIED_UNITS)
          }
          onMapClick={effectiveSimulated ? location.setSimulatedPosition : undefined}
          onSelfDragEnd={effectiveSimulated ? location.setSimulatedPosition : undefined}
          onSelectAmbulance={() => undefined}
          onSelectEmergency={() => undefined}
        />

        {/* U4: the arrival notice is now an ephemeral toast raised by the inbox
            hook at the exact arrival point (bottom-centre, auto-dismissing, never
            blocking). No second inline banner duplicates it here. */}

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
          unitResolved,
          onAccept: inbox.accept,
          onReject: inbox.reject,
          onTimeout: inbox.notifyTimeout,
        }}
        centros={mapa.centros}
        solicitudes={solicitudesRegistry}
        onSelectSolicitud={handleSelectSolicitud}
      />

      {/* U6/U7: the tapped request opens the bottom sheet with the three
          actions; "Visualizar" closes it and focuses the map on the requester. */}
      <SolicitudSheet
        open={selectedSolicitud !== null}
        onOpenChange={(open) => {
          // Reconcile explicitly in BOTH directions: a programmatic close (accept
          // or reject clearing the request) must not leave the sheet's internal
          // dialog mounted, and re-opening needs the state to move too.
          setSelectedSolicitud((current) => (open ? current : null));
        }}
        solicitud={selectedSolicitud}
        canRespond={selectedIsActive}
        onAccept={handleAcceptFromSheet}
        onReject={handleRejectFromSheet}
        onView={handleViewSolicitud}
      />

      {/*
        Location permission pop-up, mounted at PAGE level so it does not nest
        inside any other modal. It appears once per denial and stays dismissible:
        the driver console keeps working with the simulated/unit fallback.
      */}
      <LocationPermissionDialog
        status={location.status}
        permission={location.permission}
        onRetry={location.retry}
      />
    </div>
  );
}
