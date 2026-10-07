import { Check } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CitizenSummaryChips } from '@/features/ciudadano/CitizenSummaryChips';
import { formatCoordinates } from '@/features/ciudadano/citizen-request';
import {
  CITIZEN_FALLBACK_POSITION,
  countCentersByLevel,
  formatDistance,
} from '@/features/ciudadano/citizen-view';
import { DriverRail } from '@/features/conductor/DriverRail';
import { type DriverAlert, useDriverAlertsStore } from '@/features/conductor/driver-alerts-store';
import { resolveDriverAmbulanceId } from '@/features/conductor/driver-session';
import { DRIVER_STATUS_META, type DriverStatus } from '@/features/conductor/driver-status';
import { fetchHistorialSolicitudes } from '@/features/conductor/history-api';
import { fetchSolicitudesPendientes } from '@/features/conductor/pending-api';
import {
  canRespondToSolicitud,
  solicitudResponseBlockReason,
} from '@/features/conductor/solicitud-response';
import {
  DISCONNECT_BLOCKED_REASON,
  useDriverConnection,
} from '@/features/conductor/use-driver-connection';
import {
  UNIT_UNRESOLVED_REASON,
  useSolicitudInbox,
} from '@/features/conductor/use-solicitud-inbox';
import { fetchEmergencias } from '@/features/emergencias/emergency-api';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useEmergencySync } from '@/features/emergencias/use-emergency-sync';
import { fetchFlota, fetchMiAmbulancia } from '@/features/flota/fleet-api';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useFleetSync } from '@/features/flota/use-fleet-sync';
import { usePositionReport } from '@/features/flota/use-position-report';
import { LocationPermissionDialog } from '@/features/geolocalizacion/LocationPermissionDialog';
import { useDeviceLocation } from '@/features/geolocalizacion/use-device-location';
import {
  MapCanvas,
  type RequestConnector,
  type RequestMarker,
  type SelfMarker,
} from '@/features/mapa/MapCanvas';
import { useMapData } from '@/features/mapa/use-map-data';
import { useInventarioStore, withInventario } from '@/features/recursos/inventory-store';
import { useInventario } from '@/features/recursos/use-inventario';
import { unitPlateLabel } from '@/features/seguimiento/tracking';
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
import { useRealtimeReconnect } from '@/shared/realtime/use-realtime-reconnect';
import type {
  Ambulancia,
  CentroAyuda,
  Emergencia,
  SolicitudAmbulancia,
  Ubicacion,
} from '@/types/domain';

/** Stable empty list so the map props do not change identity every render. */
const NO_NOTIFIED_UNITS: readonly string[] = [];

/** Shown on a pending row while this unit is attending another request. */
const UNIT_BUSY_REASON =
  'Tu ambulancia está atendiendo un servicio: no puede tomar otra solicitud.';

interface DriverConsolePageProps {
  /** Injectable for tests; defaults to the app realtime port. */
  port?: RealtimePort | null;
  /** The unit this driver drives; defaults to the mock session mapping. */
  ambulanceId?: string;
  /** Fleet to hydrate; injectable for tests. */
  ambulancias?: Ambulancia[];
  /** Aid centers drawn on the map and listed in the rail. */
  centrosAyuda?: CentroAyuda[];
  /** Emergencies to hydrate; injectable for tests. */
  emergencias?: Emergencia[];
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
 *
 * The demo flag selects EVERY source, the same discipline `useMapData` and the
 * citizen screen use: an injected prop wins, the fixtures hydrate the zustand
 * stores only in the demo build, and off demo mode the backend snapshots do
 * (`/flota/ambulancias`, `/emergencias`). No source silently falls back to
 * fixtures off demo, so a mock `A-…`/`EMG-…`/`REQ-…` id can never mix with a
 * backend one and reach the accept/reject path.
 */
export default function DriverConsolePage({
  port = getRealtimePort(),
  ambulanceId,
  ambulancias,
  centrosAyuda,
  emergencias,
  solicitudes,
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
  // The shell writes this when the driver opens a bell notification; the effect
  // below consumes it with the page's own selection/centering logic.
  const focusRequestId = useDriverAlertsStore((state) => state.focusRequestId);
  // Declared availability where no server owns it (demo mode, or a unit that
  // does not carry the connection): "Disponible" or "Fuera de servicio".
  const [localAvailable, setLocalAvailable] = useState(true);
  const [hasCentered, setHasCentered] = useState(false);
  const [selectedSolicitud, setSelectedSolicitud] = useState<SolicitudAmbulancia | null>(null);
  const [mapFocus, setMapFocus] = useState<Ubicacion | null>(null);

  /*
    Fleet source discipline, the same one the citizen screen uses:
    - an injected list (tests, explicit callers) is the source when provided;
    - demo mode hydrates the fixtures, exactly as before;
    - off demo mode the backend snapshot (`GET /flota/ambulancias`) REPLACES the
      store, so no fixture id can mix with a backend one. A failed read leaves the
      store as-is (`hydrate` is never called with fixtures).
  */
  useEffect(() => {
    if (ambulancias !== undefined) {
      useFleetStore.getState().hydrate(ambulancias);
      return;
    }
    if (demo) {
      useFleetStore.getState().hydrate(MOCK_AMBULANCIAS);
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
        // The backend is the only fleet source off demo: no fixture fallback.
      });
    return () => {
      active = false;
    };
  }, [ambulancias, demo]);
  /*
    The broker does not replay: a state change published while the channel was
    down (a unit taking a mission, a unit being released) never arrives. When the
    channel comes back the fleet snapshot is read again, so the map cannot keep
    painting a busy unit as available. Off for injected lists and demo mode,
    whose source is not the backend.
  */
  const reloadFleet = useCallback(() => {
    fetchFlota()
      .then((unidades) => {
        useFleetStore.getState().hydrate(unidades);
      })
      .catch(() => {
        // Same rule as the mount read: a failed read leaves the store as-is.
      });
  }, []);
  useRealtimeReconnect(ambulancias === undefined && !demo ? port : null, reloadFleet);
  /*
    The mount read above can leave before the realtime channel is up. That is
    the normal order after a page reload: the old session is ending, the server
    disconnects the unit and publishes it, and this page is not subscribed yet,
    so a snapshot taken a moment too early would show the unit connected and the
    frame that corrects it would never arrive. The fleet is therefore read once
    more when the channel connects for the FIRST time after mount. A channel
    that was already up needs nothing, and later drops belong to
    `useRealtimeReconnect`.
  */
  useEffect(() => {
    if (!port || demo || ambulancias !== undefined) {
      return;
    }
    let replayed = false;
    let settled = false;
    return port.onStateChange((state) => {
      // `onStateChange` replays the current state on subscribe.
      if (!replayed) {
        replayed = true;
        settled = state === 'CONNECTED';
        return;
      }
      if (!settled && state === 'CONNECTED') {
        settled = true;
        reloadFleet();
      }
    });
  }, [port, demo, ambulancias, reloadFleet]);
  // Same rule for emergencies: a zone reported (or closed) while the channel was
  // down is only recovered by reading `GET /emergencias` again. The map and the
  // inventory re-read themselves inside `useMapData` and `useInventario`.
  const reloadEmergencies = useCallback(() => {
    fetchEmergencias()
      .then((items) => {
        useEmergencyStore.getState().hydrate(items);
      })
      .catch(() => {
        // A failed read leaves the store as-is, like the mount read.
      });
  }, []);
  useRealtimeReconnect(emergencias === undefined && !demo ? port : null, reloadEmergencies);
  // Off demo the driver's OWN unit comes from the server-scoped `/mia` resource
  // (the general fleet list no longer exposes any driver id). A failed read
  // leaves the unit unresolved and the UI says so, never substituting a fixture.
  useEffect(() => {
    if (demo || ambulanceId !== undefined) {
      return;
    }
    let active = true;
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
  /*
    Emergencies follow the SAME source discipline as the fleet: an injected list
    wins, demo mode hydrates the fixtures, and off demo mode `GET /emergencias`
    REPLACES the store. A failed read leaves the store as-is and never
    substitutes a fixture, so a mock `EMG-…` id can never reach the driver inbox.
  */
  useEffect(() => {
    if (emergencias !== undefined) {
      useEmergencyStore.getState().hydrate(emergencias);
      return;
    }
    if (demo) {
      useEmergencyStore.getState().hydrate(MOCK_EMERGENCIAS);
      return;
    }
    let active = true;
    fetchEmergencias()
      .then((items) => {
        if (active) {
          useEmergencyStore.getState().hydrate(items);
        }
      })
      .catch(() => {
        // The backend is the only emergency source off demo: no fixture fallback.
      });
    return () => {
      active = false;
    };
  }, [emergencias, demo]);
  /*
    Requests have NO listing endpoint. Off demo mode the registry starts EMPTY
    and is filled only by the `/user/queue/solicitudes` push, so a fixture
    `REQ-…` id can never be mistaken for a server one. That push does NOT replay
    on reconnect (a backend limitation): a driver who reconnects late simply sees
    no past request, never a stale fixture. Demo mode keeps the fixtures.
  */
  useEffect(() => {
    if (solicitudes !== undefined) {
      useSolicitudesStore.getState().hydrate(solicitudes);
      return;
    }
    useSolicitudesStore.getState().hydrate(demo ? MOCK_SOLICITUDES : []);
  }, [solicitudes, demo]);
  useFleetSync(port);
  useEmergencySync(port);
  useSolicitudRegistrySync(port);

  const fleetUnits = useFleetStore((state) => state.units);
  const emergencies = useEmergencyStore((state) => state.items);
  const solicitudesRegistry = useSolicitudesStore((state) => state.items);
  // Zones and centers come from the shared map source: an injected prop wins, the
  // fixtures with the demo flag on, `GET /api/v1/mapa` with it off (never a
  // silent fallback). `useMapData` ignores the fallback off demo, so the fixture
  // list is only handed over in demo mode; passing `[]` off demo makes that
  // explicit instead of relying on the ignored default.
  const centrosFixture = centrosAyuda ?? (demo ? MOCK_CENTROS_AYUDA : []);
  const mapa = useMapData(centrosFixture);

  // `/mapa` carries NO inventory, only the alert projection, so a center read
  // straight from it can never derive its real traffic light. The driver screen
  // therefore reads the inventory exactly like the citizen one (REST snapshot +
  // `/topic/suministros` upserts) and merges it onto the map centers, so BOTH
  // screens call the same `centerLevel` over the same data. `mapa.refresh`
  // re-reads the alert projection on every inventory/scarcity event, so the
  // driver's levels react live instead of freezing at "Sin declarar".
  useInventario(mapa.centros, port, mapa.refresh);
  const inventario = useInventarioStore((state) => state.itemsByCentro);
  const centros = useMemo(
    () => withInventario(mapa.centros, inventario),
    [mapa.centros, inventario],
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
    demo /topic/flota payload carries `source: 'simulated'` (off demo this
    fallback is never reported, see `usePositionReport`). With no unit either,
    `effectivePosition` stays null and the UI keeps its honest "Sin ubicación".
  */
  /*
    Connection (EP-04.F2.US1, D3). Against the backend it is DATA of the unit:
    `online` is the unit's `conectada` as the server last reported it, and the
    two buttons are REST commands. The server also disconnects the unit when the
    driver's last realtime session ends (closed tab, reload, logout), so after a
    reload the console reads its unit and shows what the server holds instead of
    assuming anything. The unit the server answers a command with is adopted into
    the fleet store by version, because the same change travels on /topic/flota
    and either of the two can land first.

    In demo mode there is no backend and the connection stays the local toggle.
    Either way it gates only the offer surface and the position report, never the
    realtime transport (flota and emergencias keep syncing).
  */
  const adoptServerUnit = useCallback((unidad: Ambulancia) => {
    useFleetStore.getState().adopt(unidad);
  }, []);
  const connection = useDriverConnection(ownUnit, adoptServerUnit);
  const { online } = connection;
  // Off demo the unit comes from the server, and so does its connection. Until
  // it is read there is nothing to connect and the real state is unknown, so the
  // two buttons wait instead of toggling a state the server is about to replace.
  const awaitingUnit = !demo && ambulanceId === undefined && ownUnit === null;

  const fallbackToUnit = location.position === null && ownUnit !== null;
  const effectivePosition = location.position ?? ownUnit?.ubicacion ?? null;
  const effectiveSimulated = location.simulated || fallbackToUnit;

  /*
    "Mi estado" (EP-04.F2.US1). Only two of the four states are declared by the
    driver: "Disponible" and "Fuera de servicio". Against the backend that is
    the unit's own `estado` (available / out of service), changed with a command,
    because only an available unit receives a request and the server has to know
    it. "En ruta" and "En escena" are never chosen: they follow the request the
    driver accepted (see `status` below), so the state cannot contradict the
    mission.

    `receiving` is what gates the offer surface: connected AND declared
    available. Out of service the driver sees no request, exactly as when
    disconnected; the accepted mission is never gated.
  */
  const declaredAvailable = connection.serverManaged
    ? ownUnit?.estado !== 'MAINTENANCE'
    : localAvailable;
  const receiving = online && declaredAvailable;

  const inbox = useSolicitudInbox(port, unitId, effectivePosition, receiving);

  /*
    Requests the push did not deliver (EP-04.F2.US1, D6). The broker does not
    replay: after a reload, or after the channel dropped for a moment, the open
    requests this unit was notified of exist only on the server. They are read
    again every time the driver IS receiving (connected and available) with a
    resolved unit — on entering that way, right after "Conectarse" or
    "Disponible", and when the realtime channel comes back — and each one goes
    through the same two places a live frame goes: the registry row and the
    inbox card.

    Only the server-managed connection reads them: demo mode and injected units
    have no such endpoint. The server answers an empty list for a disconnected
    or busy unit, so this never surfaces a request the driver cannot take.
  */
  const offerPendingRef = useRef(inbox.offerPending);
  useEffect(() => {
    offerPendingRef.current = inbox.offerPending;
  }, [inbox.offerPending]);
  const [pendingReloads, setPendingReloads] = useState(0);
  const readsPending = connection.serverManaged && receiving && unitResolved;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pendingReloads` is the reconnection tick that re-runs this read
  useEffect(() => {
    if (!readsPending) {
      return;
    }
    let active = true;
    fetchSolicitudesPendientes()
      .then((pendientes) => {
        if (!active) {
          return;
        }
        for (const pendiente of pendientes) {
          const held = useSolicitudesStore
            .getState()
            .items.find((item) => item.id === pendiente.id);
          // The REST row carries no type label; keep the one the push gave.
          useSolicitudesStore
            .getState()
            .upsert({ ...pendiente, tipo: held?.tipo ?? pendiente.tipo });
          offerPendingRef.current(pendiente);
        }
      })
      .catch(() => {
        // A failed read leaves the inbox as it is; the push keeps working.
      });
    return () => {
      active = false;
    };
  }, [readsPending, pendingReloads]);
  const reloadPending = useCallback(() => {
    setPendingReloads((count) => count + 1);
  }, []);
  useRealtimeReconnect(connection.serverManaged ? port : null, reloadPending);

  /*
    A mission this unit already holds on the server (EP-04.F2.US1, D6). The
    mission lives in the inbox's memory, so a reload used to lose it while the
    unit stayed busy on the server, with no way to finish the service. When the
    server says the unit is in a mission and the console has none, the unit's own
    services are read and the one still in service is reopened.
  */
  const restoreMissionRef = useRef(inbox.restoreMission);
  useEffect(() => {
    restoreMissionRef.current = inbox.restoreMission;
  }, [inbox.restoreMission]);
  const missingMission =
    !demo && unitResolved && ownUnit?.estado === 'ASSIGNED' && inbox.mission === null;
  useEffect(() => {
    if (!missingMission) {
      return;
    }
    let active = true;
    fetchHistorialSolicitudes()
      .then((servicios) => {
        if (!active) {
          return;
        }
        const enCurso = servicios.find(
          (servicio) => servicio.estado === 'ASSIGNED' || servicio.estado === 'CONFIRMED',
        );
        if (enCurso) {
          restoreMissionRef.current(enCurso);
        }
      })
      .catch(() => {
        // Without the read the console stays as it was; nothing is invented.
      });
    return () => {
      active = false;
    };
  }, [missingMission]);

  // An open offer owns the rail and the map only while the driver is receiving
  // requests; otherwise the mission always wins, so an in-progress service is
  // never orphaned by the toggle.
  const requestOpen = receiving && (inbox.phase === 'idle' || inbox.phase === 'submitting');
  // `C.d4`: an open mission owns the rail and the map, unless a new request is
  // actually waiting for an answer (phase idle/submitting).
  const missionActive = inbox.mission !== null && !requestOpen;

  // The four driver states, DERIVED and never stored. A mission decides it
  // first: accepted is "En ruta", arrival declared is "En escena". Without a
  // mission the driver is "Disponible" only while receiving; disconnected or out
  // of service reads "Fuera de servicio".
  const status: DriverStatus =
    inbox.mission !== null
      ? inbox.missionPhase === 'en_route'
        ? 'EN_ROUTE'
        : 'ON_SCENE'
      : receiving
        ? 'AVAILABLE'
        : 'OFF_DUTY';

  // The selected row is actionable by the SERVER's own rule — still PENDING and
  // notified to this unit (`canRespondToSolicitud`) — regardless of which
  // request arrived first or whether it is the inbox's open broadcast. The
  // accept/reject actions send `ambulanciaId`, so an unresolved unit keeps them
  // disabled (FIX B) with its honest reason instead of firing an empty id.
  //
  // A unit that is attending a request cannot take another one (EP-04.F2.US1):
  // the server refuses the accept of a busy unit, so the row says so instead of
  // offering a button that can only fail.
  const unitBusy = inbox.mission !== null;
  // For the same reason the registry stops listing the requests that are still
  // waiting for an answer while the unit is busy: they are not for this unit
  // anymore.
  //
  // And a request ANOTHER unit took is not this driver's business either: off
  // demo it leaves the registry the moment the server says so, instead of
  // staying as a "taken" row. The unit's own services stay. Demo mode keeps its
  // fixture registry as it was.
  const visibleSolicitudes = useMemo(
    () =>
      solicitudesRegistry.filter((solicitud) => {
        if (solicitud.estado === 'PENDING') {
          return !unitBusy;
        }
        if (demo || !unitResolved) {
          return true;
        }
        return (
          typeof solicitud.ambulanciaAsignadaId !== 'string' ||
          solicitud.ambulanciaAsignadaId === unitId
        );
      }),
    [unitBusy, solicitudesRegistry, demo, unitResolved, unitId],
  );
  // A row that left the registry cannot keep its detail open: the request it
  // describes is gone for this driver.
  useEffect(() => {
    if (
      selectedSolicitud !== null &&
      !visibleSolicitudes.some((solicitud) => solicitud.id === selectedSolicitud.id)
    ) {
      setSelectedSolicitud(null);
    }
  }, [selectedSolicitud, visibleSolicitudes]);
  const selectedCanRespond =
    selectedSolicitud !== null && !unitBusy && canRespondToSolicitud(selectedSolicitud, unitId);
  const selectedBlockReason =
    selectedSolicitud === null
      ? null
      : !unitResolved
        ? UNIT_UNRESOLVED_REASON
        : (solicitudResponseBlockReason(selectedSolicitud, unitId) ??
          (unitBusy ? UNIT_BUSY_REASON : null));
  // Only the outcome of the row currently selected is shown, so answering one
  // row never paints its result onto another.
  const selectedOutcome =
    inbox.responseOutcome?.requestId === selectedSolicitud?.id ? inbox.responseOutcome : null;

  /*
    MAP-2: the ONE definition of a solicitud's scene, shared by the inline
    detail's "Visualizar" and the row click (MAP-3). The fallback order is
    preserved: the active broadcast only when it IS this request, then the
    request's own pickup point, the emergency, the aid center and finally the
    zone reference point. With none of them it returns null, so no caller can
    invent a location.
  */
  const resolveSolicitudScene = useCallback(
    (solicitud: SolicitudAmbulancia): Ubicacion | null => {
      const emergency = emergencies.find((item) => item.id === solicitud.emergenciaId) ?? null;
      const centro = centros.find((item) => item.id === solicitud.centroAyudaId) ?? null;
      // A backend wire frame declares the zone, not coordinates: those come from
      // the emergency or the (real) aid center, both resolved by id.
      const zone = solicitud.zonaId
        ? centros.find((item) => item.zonaId === solicitud.zonaId)?.ubicacion
        : undefined;
      return (
        (inbox.broadcast?.requestId === solicitud.id ? inbox.broadcast?.escena : undefined) ??
        solicitud.ubicacion ??
        emergency?.ubicacion ??
        centro?.ubicacion ??
        zone ??
        null
      );
    },
    [emergencies, centros, inbox.broadcast],
  );

  // MAP-3: centre the viewport on a solicitud's scene. An unresolvable scene
  // leaves the map untouched (no invented point), exactly as "Visualizar" did.
  const centerSolicitudScene = useCallback(
    (solicitud: SolicitudAmbulancia) => {
      const scene = resolveSolicitudScene(solicitud);
      if (scene) {
        // A fresh object so a repeated focus re-flies even to the same point.
        setMapFocus({ lat: scene.lat, lng: scene.lng });
      }
    },
    [resolveSolicitudScene],
  );

  // The row click selects the solicitud AND centres the map on it (MAP-3).
  const handleSelectSolicitud = useCallback(
    (solicitud: SolicitudAmbulancia) => {
      setSelectedSolicitud(solicitud);
      centerSolicitudScene(solicitud);
    },
    [centerSolicitudScene],
  );

  /*
    Consumes the bell's "focus this request" signal. It reuses the SAME row
    selection + centering as the rail (`handleSelectSolicitud`), so opening a
    notification lands on the exact card the driver would get by clicking the
    row. While the registry has not loaded the row yet the signal stays pending
    (this effect re-runs when the registry changes); `setPending` drops it if the
    offer disappears before the row arrives.
  */
  useEffect(() => {
    if (focusRequestId === null) {
      return;
    }
    const solicitud = solicitudesRegistry.find((item) => item.id === focusRequestId) ?? null;
    if (solicitud) {
      handleSelectSolicitud(solicitud);
    } else if (inbox.broadcast?.requestId === focusRequestId && inbox.broadcast.escena) {
      // Surfaced offer whose registry row is not loaded yet: centre on its own
      // scene without inventing a registry row.
      const { lat, lng } = inbox.broadcast.escena;
      setMapFocus({ lat, lng });
    } else {
      return;
    }
    useDriverAlertsStore.getState().clearFocus();
  }, [focusRequestId, solicitudesRegistry, handleSelectSolicitud, inbox.broadcast]);

  // The inline detail's "Aceptar" answers the SELECTED row by its own id through
  // the inbox's row transport (REST against the backend, the relay in demo). It
  // never touches the inbox's single broadcast slot, and the detail stays open
  // so the server's answer stays on screen instead of being hidden by a collapse.
  const handleAcceptSelected = useCallback(() => {
    if (!selectedSolicitud || !selectedCanRespond) {
      return;
    }
    inbox.respondTo(selectedSolicitud, 'accept');
  }, [selectedSolicitud, selectedCanRespond, inbox.respondTo]);

  // "Rechazar" answers the SAME selected row by id: the server leaves it
  // PENDIENTE for the other units and the outcome is shown in the detail.
  const handleRejectSelected = useCallback(() => {
    if (!selectedSolicitud || !selectedCanRespond) {
      return;
    }
    inbox.respondTo(selectedSolicitud, 'reject');
  }, [selectedSolicitud, selectedCanRespond, inbox.respondTo]);

  // "Visualizar": collapse the detail and centre the map on the requester,
  // reusing the SAME scene resolution as the row click (MAP-2). With no
  // resolvable scene the map stays put instead of flying to an invented point.
  const handleViewSelected = useCallback(() => {
    const solicitud = selectedSolicitud;
    setSelectedSolicitud(null);
    if (!solicitud) {
      return;
    }
    centerSolicitudScene(solicitud);
  }, [selectedSolicitud, centerSolicitudScene]);

  // "Cerrar" collapses the inline detail without moving the map.
  const handleCloseSelected = useCallback(() => {
    setSelectedSolicitud(null);
  }, []);

  useEffect(() => {
    if (!hasCentered && effectivePosition) {
      setHasCentered(true);
    }
  }, [hasCentered, effectivePosition]);

  /*
    How this unit's position reaches the other screens (EP-04.F1.US1, D1).

    DEMO mode has no backend, so the unit is published on /topic/flota through
    the demo relay, exactly as before. A live mission reports the unit as
    ASSIGNED regardless of the declared status, so finishing the service really
    flips it back to AVAILABLE on the wire.

    Against the BACKEND the channel is one-way: a client never writes on
    /topic/flota (the server drops it). The position is reported by REST every
    5 s and it is the server that persists it and publishes it, so a client that
    connects late reads it too and nobody can publish a position for a unit that
    is not theirs. See `usePositionReport` for the rules.
  */
  const { heading } = location;
  useEffect(() => {
    if (!demo || !online || !port || !effectivePosition) {
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
  }, [
    demo,
    online,
    port,
    unitId,
    effectivePosition,
    heading,
    effectiveSimulated,
    status,
    missionActive,
  ]);
  // Only the driver's OWN position is reported (GPS or "Simular posición"):
  // `location.position`, never `effectivePosition`, whose fallback is the
  // position the server already holds for the unit. Echoing that one back would
  // claim the unit for a device that knows nothing and freeze it in place.
  usePositionReport({
    enabled: !demo && online && unitResolved,
    ambulanciaId: unitId,
    position: location.position,
    heading,
  });

  // "Mi estado" buttons: only the two declared states do anything, and only
  // while connected and without a mission (the rail disables them otherwise).
  const declareStatus = useCallback(
    (value: DriverStatus) => {
      if (value !== 'AVAILABLE' && value !== 'OFF_DUTY') {
        return;
      }
      const disponible = value === 'AVAILABLE';
      if (connection.serverManaged) {
        connection.declareAvailability(disponible);
        return;
      }
      setLocalAvailable(disponible);
    },
    [connection.serverManaged, connection.declareAvailability],
  );

  // "Finalizar servicio": against the backend this calls
  // `POST /solicitudes/{id}/finalizar`, which closes the request and releases
  // the unit atomically; the unit is declared available only once the server
  // confirms, and the server itself publishes the release on /topic/flota. In
  // demo it clears immediately and the demo publish effect republishes the unit
  // as AVAILABLE. Either way the rail drops back to the operations map.
  const finishService = useCallback(() => {
    // The status follows the mission by itself: once it is gone the driver is
    // back to "Disponible" (or to what the server holds for the unit).
    void inbox.finishService();
  }, [inbox.finishService]);

  const fleet = useMemo(
    () => fleetUnits.filter((unit) => unit.id !== unitId),
    [fleetUnits, unitId],
  );
  const counts = useMemo(() => countCentersByLevel(centros), [centros]);

  // "Tú" is the driver, so the marker names their own unit by its plate, never
  // the internal (UUID off demo) id.
  const selfUnitLabel = ownUnit ? unitPlateLabel(ownUnit) : unitId;
  const self: SelfMarker | null = useMemo(
    () =>
      effectivePosition
        ? {
            position: effectivePosition,
            simulated: effectiveSimulated,
            label: `Tú · ${selfUnitLabel}`,
          }
        : null,
    [effectivePosition, effectiveSimulated, selfUnitLabel],
  );

  const activeScene = (missionActive ? inbox.mission : inbox.broadcast)?.escena ?? null;
  // MAP-4: while a solicitud is selected its own scene drives the map — route,
  // request pin and connector — falling back to the active inbox scene when there
  // is no selection or the selection has no resolvable scene. The row's distance
  // and ETA below deliberately keep reading `activeScene`.
  const selectedScene = selectedSolicitud ? resolveSolicitudScene(selectedSolicitud) : null;
  const mapScene = selectedScene ?? activeScene;
  const requestDistance =
    activeScene && effectivePosition ? distanceKm(effectivePosition, activeScene) : null;
  // Straight-line estimate: the honest fallback while no route is available (AC3).
  const straightLineEta =
    activeScene && effectivePosition ? etaMinutes(effectivePosition, activeScene) : null;

  // Real street routing (OSRM), the same hook the citizen page uses, from the
  // driver's own position (`effectivePosition`) to the map's request scene
  // (`mapScene`: the selected solicitud when there is one, the active inbox scene
  // otherwise). It returns null until a route resolves and on any failure
  // (timeout, error, demo mode without coordinates), so the map and the ETA fall
  // back to today's straight-line behaviour (AC3).
  const ruta = useRuta(effectivePosition, mapScene);
  // The REAL routed duration in whole minutes, or null when there is no route.
  const routeEtaMin = ruta ? Math.max(1, Math.round(ruta.duracionMin)) : null;
  // The driver reads the routed time when it exists and the straight-line
  // estimate otherwise: never a routed time that does not exist.
  const requestEta = routeEtaMin ?? straightLineEta;

  // The shell bell mirrors the pending request COUNT and lists its offers. The
  // driver console is the only writer; while disconnected the inbox surfaces no
  // offer, so both the count and the list stay empty (gate consistency). A won
  // mission is not a pending request, so the bell drops with the card it
  // mirrored. The store resets when the page unmounts.
  const pendingAlerts = useMemo<DriverAlert[]>(
    () =>
      inbox.broadcast && !missionActive
        ? [
            {
              requestId: inbox.broadcast.requestId,
              tipo: inbox.broadcast.tipo,
              ...(inbox.broadcast.nivel ? { nivel: inbox.broadcast.nivel } : {}),
              ...(inbox.broadcast.escena ? { escena: inbox.broadcast.escena } : {}),
              timeoutEn: inbox.broadcast.timeoutEn,
            },
          ]
        : [],
    [inbox.broadcast, missionActive],
  );
  useEffect(() => {
    const { setPending } = useDriverAlertsStore.getState();
    setPending(pendingAlerts);
    return () => setPending([]);
  }, [pendingAlerts]);

  // The request has no reverse geocoding: the label is the declared zone, or the
  // real reported coordinates when the citizen declared none.
  const sceneLabel = activeScene
    ? (missionActive ? inbox.mission?.zonaId : inbox.broadcast?.zonaId) ||
      formatCoordinates(activeScene)
    : '';
  // MAP-4: the pin and its label follow the SELECTED solicitud when there is one
  // (its own zone/coordinates and the real distance to it), so selecting a
  // non-active row is never marked with the active scene's zone or distance.
  const mapSceneLabel = selectedScene
    ? selectedSolicitud?.zonaId || formatCoordinates(selectedScene)
    : sceneLabel;
  const mapSceneDistance =
    mapScene && effectivePosition ? distanceKm(effectivePosition, mapScene) : null;

  const requestMarker: RequestMarker | null = useMemo(
    () =>
      mapScene
        ? {
            position: mapScene,
            label:
              mapSceneDistance !== null
                ? `${mapSceneLabel} · ${formatDistance(mapSceneDistance)}`
                : mapSceneLabel,
          }
        : null,
    [mapScene, mapSceneLabel, mapSceneDistance],
  );

  // A straight visual connector, NOT a calculated route: no routing engine. A
  // live mission draws it solid (`C.d4`); a pending request keeps it dashed. It
  // points at the map scene, so it tracks the selected solicitud too (MAP-4).
  const requestConnector: RequestConnector | null = useMemo(
    () =>
      mapScene && effectivePosition
        ? { from: effectivePosition, to: mapScene, dashed: !missionActive }
        : null,
    [mapScene, effectivePosition, missionActive],
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
          centros={centros}
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
        units={fleet}
        status={status}
        online={online}
        onStatusChange={declareStatus}
        statusLocked={!online || unitBusy}
        offDuty={online && !declaredAvailable}
        onGoOnline={connection.connect}
        onGoOffline={connection.disconnect}
        connectionPending={connection.pending || awaitingUnit}
        disconnectBlockedReason={unitBusy ? DISCONNECT_BLOCKED_REASON : null}
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
        centros={centros}
        solicitudes={visibleSolicitudes}
        selectedSolicitud={selectedSolicitud}
        selectedCanRespond={selectedCanRespond}
        selectedBlockReason={selectedBlockReason}
        selectedOutcome={selectedOutcome}
        selectedDistanceKm={selectedSolicitud ? mapSceneDistance : null}
        onSelectSolicitud={handleSelectSolicitud}
        onAcceptSelected={handleAcceptSelected}
        onRejectSelected={handleRejectSelected}
        onViewSelected={handleViewSelected}
        onCloseSelected={handleCloseSelected}
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
