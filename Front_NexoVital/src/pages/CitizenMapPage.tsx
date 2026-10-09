import { Check, HandHeart } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { AddSupplyDialog, WithdrawSupplyDialog } from '@/features/centro/CenterSupplyDialogs';
import { CreateCenterDialog } from '@/features/centro/CreateCenterDialog';
import { MyCenterRail } from '@/features/centro/MyCenterRail';
import {
  agregarInsumo,
  type CrearMiCentroInput,
  crearMiCentro,
  type NuevoInsumoInput,
  retirarInsumo,
} from '@/features/centro/my-center-api';
import { useMyCenter } from '@/features/centro/use-my-center';
import { AcceptancePopup } from '@/features/ciudadano/AcceptancePopup';
import { ArrivalPopup } from '@/features/ciudadano/ArrivalPopup';
import { CitizenMapLegend } from '@/features/ciudadano/CitizenMapLegend';
import { type CenterAdminAction, CitizenRail } from '@/features/ciudadano/CitizenRail';
import { CitizenRequestRail } from '@/features/ciudadano/CitizenRequestRail';
import { CitizenSummaryChips } from '@/features/ciudadano/CitizenSummaryChips';
import { citizenSceneLabel, countAvailableUnits } from '@/features/ciudadano/citizen-request';
import {
  syncCitizenRequest,
  useCitizenRequestStore,
  useCitizenRequestSync,
} from '@/features/ciudadano/citizen-request-store';
import {
  CITIZEN_FALLBACK_POSITION,
  citizenUnitBucket,
  countCentersByLevel,
  nearbyAmbulances,
} from '@/features/ciudadano/citizen-view';
import {
  CenterDetailRail,
  DonationCenterPicker,
  DonationDialog,
} from '@/features/donaciones/DonationFlow';
import {
  type DonationRecord,
  donableCenters,
  donationToast,
  useDonationStore,
  withDonations,
} from '@/features/donaciones/donation';
import { CitizenReportDialog } from '@/features/emergencias/CitizenReportDialog';
import {
  fetchEmergencias,
  type ReportarEmergenciaInput,
  reportarEmergencia,
} from '@/features/emergencias/emergency-api';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useEmergencySync } from '@/features/emergencias/use-emergency-sync';
import { fetchFlota } from '@/features/flota/fleet-api';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useFleetSync } from '@/features/flota/use-fleet-sync';
import { reverseGeocode } from '@/features/geocodificacion/geocoding-api';
import { LocationPermissionDialog } from '@/features/geolocalizacion/LocationPermissionDialog';
import { useDeviceLocation } from '@/features/geolocalizacion/use-device-location';
import { MapCanvas, type RequestConnector, type SelfMarker } from '@/features/mapa/MapCanvas';
import {
  applyMapFilter,
  countMapLayers,
  type MapFilterLayer,
  type MapFilterState,
  readPersistedMapFilter,
  toggleMapFilter,
  writePersistedMapFilter,
} from '@/features/mapa/map-filter';
import { useMapData } from '@/features/mapa/use-map-data';
import { fetchInventario, registrarDonacion } from '@/features/recursos/inventory-api';
import { useInventarioStore, withInventario } from '@/features/recursos/inventory-store';
import { centroSemaforo } from '@/features/recursos/traffic-light';
import { useInventario } from '@/features/recursos/use-inventario';
import { unitPlateLabel } from '@/features/seguimiento/tracking';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { useSolicitudRegistrySync } from '@/features/solicitudes/use-solicitud-registry-sync';
import { useSessionSync } from '@/features/usuarios/session-sync';
import { useRuta } from '@/hooks/use-ruta';
import { etaMinutes } from '@/lib/geo';
import {
  MOCK_AMBULANCIAS,
  MOCK_CENTROS_AYUDA,
  MOCK_EMERGENCIAS,
  MOCK_SOLICITUDES,
} from '@/mocks/fixtures';
import { ApiError, isDemoMode } from '@/services/apiClient';
import {
  DESTINATIONS,
  type EmergencyUpsertPayload,
  getRealtimePort,
  type RealtimePort,
} from '@/shared/realtime';
import { useRealtimeReconnect } from '@/shared/realtime/use-realtime-reconnect';
import type {
  Ambulancia,
  CentroAyuda,
  Emergencia,
  InventarioItem,
  SolicitudAmbulancia,
  Ubicacion,
} from '@/types/domain';

/**
 * Emergencies are LIVE ALERTS, not a decorative map layer, so the citizen map
 * paints them from the store and deliberately keeps them OUTSIDE the layer
 * filter: `applyMapFilter` only knows `{centros, ambulancias}` and would
 * drop them. Hiding an active alert is a safety anti-pattern ("la alerta no se
 * pierde"), so there is no empty-constant short-circuit here.
 */

/** Stable empty id list: keeps the MapCanvas memo props stable while idle. */
const NO_UNIT_IDS: readonly string[] = [];

/**
 * Confirmation raised once a citizen report succeeds, in both modes. It is
 * honest with a backend (the emergency was created) and in the demo build (it was
 * registered and published over the relay): it never claims a server round-trip.
 */
const REPORT_SUCCESS_MESSAGE =
  'Reporte registrado. Los centros de ayuda cercanos lo verán en el mapa.';

/** Reason shown while the center action cannot be used, by cause. */
const CENTER_ACTION_DEMO_REASON =
  'Administrar un centro necesita el servidor; no está en el modo demo.';
const CENTER_ACTION_LOADING_REASON = 'Consultando tu centro…';
const CENTER_ACTION_ERROR_REASON = 'No pudimos consultar tu centro. Toca para reintentar.';

interface CitizenMapPageProps {
  /**
   * `true` renders the help-center administrator's variant (EP-03.F1.US1): the
   * same map and the same actions, except that "Donar suministros" is replaced
   * by "Crear centro" / "Administrar mi centro". Defaults to the citizen screen.
   */
  centerAdmin?: boolean;
  ambulancias?: Ambulancia[];
  emergencias?: Emergencia[];
  solicitudes?: SolicitudAmbulancia[];
  centrosAyuda?: CentroAyuda[];
  /** Injectable for tests; defaults to the app realtime port. */
  port?: RealtimePort | null;
}

/**
 * Citizen operations screen: header with live counts, the shared emergency map
 * centered on the citizen, and a rail with the role actions, the nearest units
 * and the aid centers.
 *
 * The demo flag selects EVERY source, the same discipline `useMapData` uses:
 * in the demo build the fixtures hydrate the zustand stores, and off demo mode
 * the backend snapshots do (`/flota/ambulancias`, `/emergencias`, `/mapa`). An
 * injected prop always wins. No source silently falls back to fixtures off demo,
 * so a mock id can never mix with a backend one — the defect that sent `EMG-002`
 * to `POST /solicitudes`. The realtime layer UPSERTs remote changes on top of
 * whichever base was loaded.
 *
 * The help-center administrator lands on this same screen with `centerAdmin`:
 * they can request an ambulance, report a zone and read the map like a citizen,
 * and manage their own center instead of donating.
 */
export default function CitizenMapPage({
  centerAdmin = false,
  ambulancias,
  emergencias,
  solicitudes,
  centrosAyuda,
  port = getRealtimePort(),
}: CitizenMapPageProps) {
  const demo = isDemoMode();

  /*
    Fleet hydration is source-selected, never a silent mock base:
    - an injected list (tests, explicit callers) is the source when provided;
    - demo mode hydrates the fixtures, exactly as before;
    - off demo mode the backend snapshot REPLACES the store, so no fixture id can
      ever mix with a backend id. A failed read leaves the store as-is
      (`hydrate` is never called with fixtures), and the legend then states the
      honest count it has instead of a mocked one.
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
  /*
    Emergencies follow the SAME source discipline as the fleet: an injected list
    wins, demo mode hydrates the fixtures, and off demo mode `GET
    /api/v1/emergencias` REPLACES the store's contents. A failed read leaves the
    store as-is and never substitutes a fixture, so the citizen request can never
    anchor itself to a mock `EMG-…` id.
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
    Requests have NO listing endpoint: the registry is fed by the realtime push
    (which does not replay), so off demo mode it starts EMPTY rather than seeding
    fixtures whose `REQ-…` ids would mix with server ids. Demo mode keeps the
    fixtures, exactly as before.
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
  useCitizenRequestSync(port);

  // Recovers the citizen's active request after a reload or a dropped channel (EP-04.F2.US9).
  const readOwnRequest = solicitudes === undefined && !demo;
  useEffect(() => {
    if (readOwnRequest) {
      syncCitizenRequest();
    }
  }, [readOwnRequest]);
  useRealtimeReconnect(readOwnRequest ? port : null, syncCitizenRequest);

  // Another tab of the same origin can replace the shared token/session while
  // this screen stays mounted (the `storage` event fires here, in the other
  // document). Detect it proactively: state the honest reason so the rail never
  // sends — nor offers — a request with a foreign token.
  useSessionSync(
    useCallback(() => {
      useCitizenRequestStore.getState().flagSessionDesync();
    }, []),
  );

  const fleet = useFleetStore((state) => state.units);
  const emergencies = useEmergencyStore((state) => state.items);
  const location = useDeviceLocation();
  // Zones and centers come from the shared map source: an injected prop wins, the
  // fixtures with the demo flag on, `GET /api/v1/mapa` with it off (never a
  // silent fallback). The mock is only offered to `useMapData` in demo mode, so
  // off demo it is never even handed over.
  const centrosFixture = centrosAyuda ?? (demo ? MOCK_CENTROS_AYUDA : []);
  const mapa = useMapData(centrosFixture);

  // Inventory (EP-03): with the demo flag off the items come from the backend
  // (REST snapshot + `/topic/suministros` upserts); with it on the fixtures
  // already carry them, so the store stays empty and the merge is a no-op.
  // `mapa.refresh` re-reads the map read-model on every inventory event so the
  // centres' active-alert projection (only exposed by `/api/v1/mapa`) stays in
  // sync when a donation clears demand or a rejection raised it.
  useInventario(mapa.centros, port, mapa.refresh);
  const inventario = useInventarioStore((state) => state.itemsByCentro);

  // Donations MUTATE the front state on top of that inventory-backed base:
  // `updated` holds the centers whose inventory changed locally (demo mode).
  // In backend mode the items already come from the server, so that overlay is
  // empty and a real donation lands in the inventory store instead.
  const updatedCentros = useDonationStore((state) => state.updated);
  const centros = useMemo(
    () => withDonations(withInventario(mapa.centros, inventario), updatedCentros),
    [mapa.centros, inventario, updatedCentros],
  );

  // Map layer filter (FD-1/FD-2/FD-4). The choice lives HERE, is applied ONLY to
  // the props MapCanvas receives, and never touches a store: an event that lands
  // while its layer is hidden stays in the store and paints as soon as the layer
  // is toggled back on (AC2). It is persisted so a refresh does not reset it,
  // following the same plain-localStorage pattern `layers-store` already uses.
  const [mapFilter, setMapFilter] = useState<MapFilterState>(readPersistedMapFilter);
  const mapLayers = useMemo(() => ({ centros, ambulancias: fleet }), [centros, fleet]);
  // What the map is allowed to paint: hidden layers arrive as empty lists.
  const visibleMapLayers = useMemo(
    () => applyMapFilter(mapFilter, mapLayers),
    [mapFilter, mapLayers],
  );
  const mapFilterCounts = useMemo(() => countMapLayers(mapLayers), [mapLayers]);
  const handleToggleFilter = useCallback(
    (layer: MapFilterLayer) => {
      const next = toggleMapFilter(mapFilter, layer);
      writePersistedMapFilter(next);
      setMapFilter(next);
    },
    [mapFilter],
  );

  // Center detail (mockup c7/c8/c9). It only takes over while no ambulance
  // request is open, so the request flow is never disturbed.
  const [detailCentroId, setDetailCentroId] = useState<string | null>(null);
  const [donationOpen, setDonationOpen] = useState(false);
  // "Donar suministros" opens the picker, never a center: the citizen chooses.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lastDonation, setLastDonation] = useState<DonationRecord | null>(null);
  const detailCentro = useMemo(
    () => centros.find((centro) => centro.id === detailCentroId) ?? null,
    [centros, detailCentroId],
  );
  // The centers that can receive a donation, worst first. The list only decides
  // whether the action is offered; it never picks one for the citizen.
  const donable = useMemo(() => donableCenters(centros), [centros]);

  // --- Help-center administrator's own center (EP-03.F1.US1) ------------------
  // Backend only: the demo build has no server to own a center, so the hook
  // stays off there and the action is offered disabled with its reason.
  const myCenter = useMyCenter(centerAdmin && !demo);
  const myCentroId = myCenter.centro?.id ?? null;
  const [manageOpen, setManageOpen] = useState(false);
  const [createCenterOpen, setCreateCenterOpen] = useState(false);
  const [addSupplyOpen, setAddSupplyOpen] = useState(false);
  const [withdrawItemId, setWithdrawItemId] = useState<string | null>(null);
  // The center as the rail paints it. Identity comes from the map's copy when
  // the map already knows the center (it carries the alert projection), and the
  // inventory comes from the shared store, which holds the LIVE items (REST
  // snapshot + realtime upserts, so a citizen's donation shows up here). Until
  // the store has read this center, the items the center read returned are
  // used: the panel never opens empty while that second read is in flight.
  const myCentro: CentroAyuda | null = useMemo(() => {
    const propio = myCenter.centro;
    if (!propio) {
      return null;
    }
    const onMap = centros.find((centro) => centro.id === propio.id);
    const items = inventario[propio.id] ?? propio.items;
    if (onMap) {
      return { ...onMap, items, inventarioCargado: true };
    }
    return {
      id: propio.id,
      nombre: propio.nombre,
      ubicacion: propio.ubicacion,
      tipo: 'CENTRO_ACOPIO',
      items,
      inventarioCargado: true,
    };
  }, [myCenter.centro, centros, inventario]);
  const withdrawItem: InventarioItem | null = useMemo(
    () => myCentro?.items.find((item) => item.id === withdrawItemId) ?? null,
    [myCentro, withdrawItemId],
  );

  const requestPhase = useCitizenRequestStore((state) => state.phase);
  // Honest reason the last attempt could not start (no active emergency, no
  // zone, no center, backend rejection); rendered by the rail so a blocked
  // request never looks dead.
  const requestError = useCitizenRequestStore((state) => state.startError);
  // Honest reason the last cancellation was refused (409 already assigned, 403
  // not the requester); rendered next to the cancel action, never as a fake close.
  const requestCancelError = useCitizenRequestStore((state) => state.cancelError);
  const requestStartedAt = useCitizenRequestStore((state) => state.startedAt);
  const notifiedIds = useCitizenRequestStore((state) => state.notifiedIds);
  const acceptedBy = useCitizenRequestStore((state) => state.acceptedBy);
  const acceptedAt = useCitizenRequestStore((state) => state.acceptedAt);
  const arrivedAt = useCitizenRequestStore((state) => state.arrivedAt);
  const confirmedAt = useCitizenRequestStore((state) => state.confirmedAt);
  const searching = requestPhase === 'searching';
  const accepted = requestPhase === 'accepted';
  const arrived = requestPhase === 'arrived';
  const closed = requestPhase === 'closed';
  const expired = requestPhase === 'expired';
  // The c4/c5/c6 rail replaces the search for good once a unit is assigned.
  const assigned = accepted || arrived || closed;

  // The acceptance popup is a one-shot notice: it opens when the phase turns
  // accepted (only for OUR request — the store ignores other request ids) and
  // closes itself. "Cerrar" is just a shortcut; the c4 rail stays underneath.
  const [acceptanceOpen, setAcceptanceOpen] = useState(false);
  useEffect(() => {
    setAcceptanceOpen(accepted && acceptedBy !== null);
  }, [accepted, acceptedBy]);
  const closeAcceptance = useCallback(() => setAcceptanceOpen(false), []);

  // The arrival dialog is a real modal that asks for an answer, but it can be
  // dismissed without confirming. Dismissing reveals the c5 rail, whose
  // "Cancelar solicitud" is the honest exit from a false arrival.
  const [arrivalOpen, setArrivalOpen] = useState(false);
  useEffect(() => {
    setArrivalOpen(arrived && acceptedBy !== null);
  }, [arrived, acceptedBy]);
  const closeArrival = useCallback(() => setArrivalOpen(false), []);

  // Device position when the browser grants it; a Suba fallback otherwise, so
  // the "Tú" marker (and the distances in the rail) always have an origin. The
  // fallback is tracked separately so the subtitle never claims it is the real
  // location, and the request is labelled as a reference/demo point instead.
  const selfPosition = location.position ?? CITIZEN_FALLBACK_POSITION;
  const usingFallbackPosition = location.position === null;

  // "Reportar zona afectada" (task 250): the report dialog and the point it takes
  // as the map center. The center tracks MapCanvas pans and resets to the citizen
  // whenever the device position changes. The dialog only uses it to BIAS the
  // address search towards the part of the city the citizen is looking at.
  const [reportOpen, setReportOpen] = useState(false);
  const [mapCenter, setMapCenter] = useState<Ubicacion>(selfPosition);
  useEffect(() => {
    setMapCenter(selfPosition);
  }, [selfPosition]);

  // Pickup point for the request. The device fix wins; when the browser denies
  // geolocation the citizen marks the point by clicking the map. `null` means
  // neither exists, and the request reports that honestly instead of sending a
  // fake origin.
  const [pickedPoint, setPickedPoint] = useState<Ubicacion | null>(null);
  const pickupPoint = location.position ?? pickedPoint;
  const pickupByMap = location.position === null && pickedPoint !== null;
  const handlePickupClick = useCallback((punto: Ubicacion) => {
    setPickedPoint(punto);
  }, []);

  // Readable address of the pickup point, resolved ahead so the request sends it at once.
  const [pickupAddress, setPickupAddress] = useState<string | null>(null);
  const pickupKey = pickupPoint
    ? `${pickupPoint.lat.toFixed(4)},${pickupPoint.lng.toFixed(4)}`
    : '';
  useEffect(() => {
    setPickupAddress(null);
    if (!pickupKey) {
      return;
    }
    const [lat, lng] = pickupKey.split(',').map(Number);
    let active = true;
    reverseGeocode({ lat, lng })
      .then((address) => {
        if (active) {
          setPickupAddress(address);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [pickupKey]);

  const counts = useMemo(() => countCentersByLevel(centros), [centros]);
  const nearby = useMemo(() => nearbyAmbulances(fleet, selfPosition), [fleet, selfPosition]);
  const availableCount = useMemo(() => countAvailableUnits(fleet), [fleet]);
  const self: SelfMarker = useMemo(
    () => ({
      position: selfPosition,
      simulated: location.simulated,
      label: 'Tú',
    }),
    [selfPosition, location.simulated],
  );

  // Only while a search is open: the alerted units wear the ring, the occupied
  // units dim back (mockup `C.c3`), and the radar rings anchor on the citizen.
  const dimmedIds = useMemo(
    () =>
      searching
        ? fleet.filter((unit) => citizenUnitBucket(unit) !== 'free').map((unit) => unit.id)
        : NO_UNIT_IDS,
    [searching, fleet],
  );

  const handleRequest = useCallback(() => {
    // A request takes over the rail, so any open donation picker is dropped,
    // and so is the administrator's center panel.
    setPickerOpen(false);
    setManageOpen(false);
    // `start` decides the transport (relay in demo, REST against a backend) and
    // resolves when the search state is set; the handler stays fire-and-forget.
    // The pickup point is the device fix, or the point marked on the map when
    // the GPS was denied; with neither, `start` reports the honest reason.
    void useCitizenRequestStore.getState().start({
      port,
      units: useFleetStore.getState().units,
      origin: pickupPoint,
      direccion: pickupAddress,
    });
  }, [port, pickupPoint, pickupAddress]);

  const handleCancel = useCallback(() => {
    // `cancel` decides the transport (relay in demo, REST against a backend) and
    // resolves once the server owns the outcome; the handler stays fire-and-forget.
    void useCitizenRequestStore.getState().cancel(port);
  }, [port]);

  const handleConfirmArrival = useCallback(() => {
    useCitizenRequestStore.getState().confirmArrival(port);
  }, [port]);

  // `C.c6` "Volver al mapa": the closed request is dropped and the map rail
  // comes back; nothing is republished because the loop is already closed.
  const handleBackToMap = useCallback(() => {
    useCitizenRequestStore.getState().reset();
  }, []);

  // FR-6: the citizen report submit branch (FW-5). `apiFetch` always hits the
  // network, so demo mode builds the emergency locally and publishes it through
  // the port, mirroring `SalaOperacionesPage.handleCreateEmergency`. With a
  // backend, the POST result is upserted for immediate feedback; the follow-up
  // push is idempotent by id.
  //
  // On success BOTH branches fall through to a single `toast(...)` at the end:
  // one confirmation per submit, and the failure path stays untouched (it throws
  // past the toast, and the dialog alone shows the error).
  const handleReportSubmit = useCallback(
    async (input: ReportarEmergenciaInput) => {
      if (isDemoMode()) {
        const emergency: Emergencia = {
          // A UUID, not `nextEmergencyId`: the latter derives the id from the
          // LOCAL store, so two demo clients on the same relay compute the same
          // `EMG-00n` and the store's merge-by-id makes the second report
          // overwrite the first. `randomUUID()` is unique per client.
          id: crypto.randomUUID(),
          ubicacion: input.ubicacion,
          tipo: input.tipo,
          nivel: input.nivel,
          estado: 'REPORTED',
          descripcion: input.descripcion,
          zonaId: '',
          createdAt: new Date().toISOString(),
        };
        useEmergencyStore.getState().upsert(emergency);
        port?.publish(DESTINATIONS.emergencias, {
          type: 'emergency.upsert',
          emergency,
        } satisfies EmergencyUpsertPayload);
      } else {
        const emergency = await reportarEmergencia(input);
        useEmergencyStore.getState().upsert(emergency);
      }
      toast(REPORT_SUCCESS_MESSAGE);
    },
    [port],
  );

  // --- Donation flow (mockup c7/c8/c9) ---------------------------------------

  // Opens a center's c7 detail and closes the picker: the same handler serves the
  // picker row and the map tap, so both paths land on the identical detail.
  const openCenterDetail = useCallback(
    (id: string) => {
      setPickerOpen(false);
      // The administrator's OWN center opens its management panel, not the
      // donation detail: they administer it, they do not donate to it.
      if (centerAdmin && id === myCentroId) {
        setDetailCentroId(null);
        setManageOpen(true);
        return;
      }
      setManageOpen(false);
      setDetailCentroId(id);
      setLastDonation(null);
    },
    [centerAdmin, myCentroId],
  );

  // "Donar suministros" only OPENS THE PICKER. It never selects a center: the
  // citizen chooses one from the list or taps it on the map (criterion 3).
  const handleDonate = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const handleBackFromDetail = useCallback(() => {
    setDetailCentroId(null);
    setDonationOpen(false);
    setLastDonation(null);
  }, []);

  // U1 / D-U1: a click on the map background releases the center detail exactly
  // like "Volver al mapa", and also drops a half-open donation picker so the
  // rail really comes back instead of staying stuck behind the map.
  const handleClearSelection = useCallback(() => {
    setPickerOpen(false);
    setManageOpen(false);
    handleBackFromDetail();
  }, [handleBackFromDetail]);

  // --- Center administration (EP-03.F1.US1) ----------------------------------

  // Creates the center. The response already carries the center and its items,
  // so they go straight into the shared state; the map read-model is read again
  // so the new center is painted without waiting for the realtime frame. A
  // failure is rethrown: the dialog stays open and shows the backend's message.
  const { setCentro: setMyCentro, reload: reloadMyCenter } = myCenter;
  const refreshMapa = mapa.refresh;
  const handleCreateCenter = useCallback(
    async (input: CrearMiCentroInput) => {
      const creado = await crearMiCentro(input);
      useInventarioStore.getState().hydrate(creado.id, creado.items);
      setMyCentro(creado);
      refreshMapa();
      setDetailCentroId(null);
      setManageOpen(true);
      toast(`Centro "${creado.nombre}" creado. Ya aparece en el mapa.`);
    },
    [setMyCentro, refreshMapa],
  );

  const handleAddSupply = useCallback(async (input: NuevoInsumoInput) => {
    const item = await agregarInsumo(input);
    useInventarioStore.getState().upsert(item);
    toast(`Insumo "${item.nombre}" agregado al centro.`);
  }, []);

  // Withdrawing is the existing dispatch (atomic decrement). The response is the
  // item after the decrement, and the realtime upsert repeats it idempotently.
  const handleWithdrawSupply = useCallback(
    async (item: InventarioItem, cantidad: number, motivo: string) => {
      if (!myCentroId) {
        return;
      }
      const actualizado = await retirarInsumo(myCentroId, item.id, cantidad, motivo);
      useInventarioStore.getState().upsert(actualizado);
      toast(
        `Retiraste ${cantidad} de ${actualizado.nombre}. Quedan ${actualizado.disponible} de ${actualizado.requerido}.`,
      );
    },
    [myCentroId],
  );

  // The one action that differs from the citizen's: create the center while
  // there is none, manage it once it exists. Every disabled state says why.
  const centerAction: CenterAdminAction | undefined = useMemo(() => {
    if (!centerAdmin) {
      return undefined;
    }
    if (demo) {
      return {
        label: 'Administrar mi centro',
        onClick: () => undefined,
        disabled: true,
        reason: CENTER_ACTION_DEMO_REASON,
      };
    }
    if (myCenter.status === 'ready') {
      return { label: 'Administrar mi centro', onClick: () => setManageOpen(true) };
    }
    if (myCenter.status === 'none') {
      return { label: 'Crear centro', onClick: () => setCreateCenterOpen(true) };
    }
    if (myCenter.status === 'error') {
      // Unknown whether a center exists: never offer "Crear centro" on a guess.
      return {
        label: 'Reintentar consulta de mi centro',
        onClick: reloadMyCenter,
        reason: CENTER_ACTION_ERROR_REASON,
      };
    }
    return {
      label: 'Administrar mi centro',
      onClick: () => undefined,
      disabled: true,
      reason: CENTER_ACTION_LOADING_REASON,
    };
  }, [centerAdmin, demo, myCenter.status, reloadMyCenter]);

  // Confirming applies the donation and remembers the level the center moved
  // from, so the c9 card can say "Antes estaba en crítico". With the demo flag on
  // it mutates the front state; with it off it calls the real endpoint and the
  // resulting item comes from the response (the realtime upsert repeats it
  // idempotently by id).
  const handleConfirmDonation = useCallback(
    async (itemId: string, amount: number) => {
      if (!detailCentro) {
        return;
      }
      const beforeCenterLevel = centroSemaforo(detailCentro);
      if (isDemoMode()) {
        const next = useDonationStore.getState().donate(detailCentro, itemId, amount);
        setLastDonation({ centroId: next.id, itemId, amount, beforeCenterLevel });
        setDonationOpen(false);
        return;
      }
      try {
        const { item, aceptada, ofrecida } = await registrarDonacion(
          detailCentro.id,
          itemId,
          amount,
        );
        useInventarioStore.getState().upsert(item);
        // The record carries what REALLY entered: the server caps the donation
        // to the gap, so a donor who offered more than was missing completes the
        // need with less and the card must not claim the offered amount.
        setLastDonation({
          centroId: detailCentro.id,
          itemId,
          amount: aceptada,
          beforeCenterLevel,
        });
        setDonationOpen(false);
        if (aceptada < ofrecida) {
          toast(
            `Se aceptaron ${aceptada} de las ${ofrecida} unidades: era lo que faltaba para completar la necesidad.`,
          );
        }
      } catch (error) {
        if (error instanceof ApiError && error.codigo === 'NECESIDAD_CUBIERTA') {
          // The donor who lost the race: another donor completed the need. The
          // dialog closes (there is nothing left to donate) and the center is
          // re-read so the rail shows the real, covered state.
          setDonationOpen(false);
          toast(error.message, 'error');
          void fetchInventario(detailCentro.id)
            .then((items) => useInventarioStore.getState().hydrate(detailCentro.id, items))
            .catch(() => undefined);
          return;
        }
        // The dialog stays open so the citizen can retry; the backend's Spanish
        // `mensaje` is surfaced instead of a silent failure.
        toast(
          error instanceof Error ? error.message : 'No se pudo registrar la donación.',
          'error',
        );
      }
    },
    [detailCentro],
  );

  // The assigned unit as the live fleet knows it: the popup's id is real, and
  // the c4/c5/c6 rail and map read the unit's own driver, plate, model and type.
  const assignedUnit = useMemo(
    () => (assigned && acceptedBy ? (fleet.find((unit) => unit.id === acceptedBy) ?? null) : null),
    [assigned, acceptedBy, fleet],
  );

  // Solid connector from the assigned unit to the citizen (mockup `C.c4`); it is
  // a visual connector, not a calculated route. It is the honest FALLBACK: with a
  // real route on screen, `MapCanvas` draws the route instead of this line (AC3).
  const acceptanceConnector: RequestConnector | null = useMemo(
    () => (assignedUnit ? { from: assignedUnit.ubicacion, to: selfPosition, dashed: false } : null),
    [assignedUnit, selfPosition],
  );

  // Real street routing (OSRM) for the ASSIGNED unit only, toward the citizen.
  // The hook returns null until a route resolves and on any failure, so the map
  // and the ETA fall back to the straight-line behaviour (AC3).
  const ruta = useRuta(assignedUnit?.ubicacion ?? null, assignedUnit ? selfPosition : null);
  const routeEtaMin = ruta ? Math.max(1, Math.round(ruta.duracionMin)) : null;

  // The assigned unit's marker carries its ETA label ("WNR-418 · 5 min"), named
  // by its plate: the real routed duration when there is a route, the
  // straight-line estimate otherwise.
  const ambulanceLabels = useMemo(
    () =>
      assignedUnit
        ? {
            [assignedUnit.id]: `${unitPlateLabel(assignedUnit)} · ${
              routeEtaMin ?? etaMinutes(assignedUnit.ubicacion, selfPosition)
            } min`,
          }
        : undefined,
    [assignedUnit, selfPosition, routeEtaMin],
  );

  // The donation that produced this center's current c9 state, if any. Narrowed
  // here so the rail and the toast read a non-null record.
  const detailDonation =
    detailCentro && lastDonation?.centroId === detailCentro.id ? lastDonation : null;
  const donatedItem =
    detailCentro && detailDonation
      ? (detailCentro.items.find((item) => item.id === detailDonation.itemId) ?? null)
      : null;
  const donationMessage =
    detailCentro && detailDonation && donatedItem
      ? donationToast(detailCentro, detailDonation, donatedItem)
      : null;
  const showManage = requestPhase === 'idle' && manageOpen && myCentro !== null;
  const showDetail = requestPhase === 'idle' && !showManage && detailCentro !== null;

  const title = showManage
    ? 'Mi centro'
    : detailCentro && showDetail
      ? 'Centro de acopio'
      : searching
        ? 'Pidiendo ambulancia'
        : accepted
          ? 'Tu ambulancia va en camino'
          : arrived
            ? 'Tu ambulancia llegó'
            : closed
              ? 'Solicitud atendida'
              : expired
                ? 'Solicitud expirada'
                : 'Mapa de operación';
  const subtitle = showManage
    ? `Administras ${myCentro?.nombre ?? 'tu centro'}`
    : detailCentro && showDetail
      ? detailDonation
        ? `El semáforo de ${detailCentro.nombre} se actualizó para todos`
        : `Seleccionaste ${detailCentro.nombre} en el mapa`
      : searching || accepted || arrived
        ? citizenSceneLabel(selfPosition, {
            fallback: usingFallbackPosition,
            direccion: usingFallbackPosition ? null : pickupAddress,
          })
        : 'Suba, Bogotá · en vivo';

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto bg-nv-mint text-nv-navy lg:grid lg:grid-cols-[minmax(0,1fr)_344px] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-5 lg:overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-3 lg:col-span-2">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
          <p className="mt-1 flex items-center gap-2 text-nv-navy-400 text-sm">
            <span
              className="size-2 shrink-0 rounded-full bg-nv-teal shadow-[0_0_0_3px_rgb(93_186_168_/_0.28)]"
              aria-hidden
            />
            {subtitle}
          </p>
        </div>
        <CitizenSummaryChips counts={counts} />
      </header>

      <section
        aria-label="Mapa de centros de acopio y ambulancias"
        className="relative h-[52dvh] min-h-[300px] shrink-0 overflow-hidden rounded-nv-lg shadow-nv-card lg:h-auto lg:min-h-0"
      >
        <MapCanvas
          ambulancias={visibleMapLayers.ambulancias}
          emergencias={emergencies}
          centros={visibleMapLayers.centros}
          center={selfPosition}
          focus={
            showManage && myCentro
              ? myCentro.ubicacion
              : showDetail && detailCentro
                ? detailCentro.ubicacion
                : null
          }
          self={self}
          selectedAmbulanceId={assigned ? acceptedBy : null}
          selectedCentroId={showManage ? myCentroId : (detailCentro?.id ?? null)}
          changedCentroId={detailDonation?.centroId ?? null}
          selfRings={searching}
          notifiedAmbulanceIds={searching ? notifiedIds : NO_UNIT_IDS}
          dimmedAmbulanceIds={dimmedIds}
          requestConnector={acceptanceConnector}
          ruta={ruta}
          ambulanceLabels={ambulanceLabels}
          request={
            requestPhase === 'idle' && pickupByMap && pickedPoint
              ? { position: pickedPoint, label: 'Punto de recogida' }
              : null
          }
          onCenterChange={setMapCenter}
          // While the simulation is active a map click PLACES the citizen, the
          // driver's own affordance; with the GPS denied and no simulation it
          // keeps its old job of marking the request's pickup point (a different
          // feature). A simulated position leaves `location.position` non-null,
          // so the pickup path and its marker stay off by construction.
          onMapClick={
            location.simulated
              ? location.setSimulatedPosition
              : requestPhase === 'idle' && location.position === null
                ? handlePickupClick
                : undefined
          }
          onSelfDragEnd={location.simulated ? location.setSimulatedPosition : undefined}
          onClearSelection={handleClearSelection}
          onSelectAmbulance={() => undefined}
          onSelectEmergency={() => undefined}
          onSelectCentro={requestPhase === 'idle' ? openCenterDetail : undefined}
        />
        <CitizenMapLegend counts={counts} units={fleet} />

        {/* `C.c6`: the closing toast. It exists only once the citizen actually
            confirmed; a backend close that skipped their confirmation must not
            claim it happened. */}
        {closed && confirmedAt !== null && (
          <div className="pointer-events-none absolute inset-x-0 top-5 z-[1000] flex justify-center px-3">
            <div className="flex items-center gap-2.5 rounded-nv-md bg-nv-navy px-4 py-3 font-medium text-sm text-white shadow-nv-float">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-nv-lime text-nv-navy">
                <Check className="size-4" aria-hidden />
              </span>
              Confirmaste la llegada. Tu solicitud quedó cerrada.
            </div>
          </div>
        )}

        {/* `C.c9`: the donation toast, with the real amount and level change. */}
        {donationMessage && (
          <div className="pointer-events-none absolute inset-x-0 top-5 z-[1000] flex justify-center px-3">
            <div className="flex items-center gap-2.5 rounded-nv-md bg-nv-navy px-4 py-3 font-medium text-sm text-white shadow-nv-float">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-nv-lime text-nv-navy">
                <HandHeart className="size-4" aria-hidden />
              </span>
              {donationMessage}
            </div>
          </div>
        )}
      </section>

      {requestPhase !== 'idle' ? (
        <CitizenRequestRail
          phase={requestPhase}
          notifiedIds={notifiedIds}
          startedAt={requestStartedAt}
          acceptedBy={acceptedBy}
          acceptedAt={acceptedAt}
          arrivedAt={arrivedAt}
          confirmedAt={confirmedAt}
          units={fleet}
          origin={selfPosition}
          duracionMin={routeEtaMin}
          onCancel={handleCancel}
          cancelError={requestCancelError}
          onBackToMap={handleBackToMap}
        />
      ) : showManage && myCentro ? (
        <MyCenterRail
          centro={myCentro}
          onAddSupply={() => setAddSupplyOpen(true)}
          onWithdraw={(item) => setWithdrawItemId(item.id)}
          onBackToMap={() => setManageOpen(false)}
        />
      ) : detailCentro && showDetail ? (
        <CenterDetailRail
          centro={detailCentro}
          origin={selfPosition}
          lastDonation={detailDonation}
          onDonate={() => setDonationOpen(true)}
          onBackToMap={handleBackFromDetail}
        />
      ) : pickerOpen ? (
        <DonationCenterPicker
          centros={donable}
          onSelect={openCenterDetail}
          onCancel={() => setPickerOpen(false)}
        />
      ) : (
        <CitizenRail
          nearby={nearby}
          centros={centros}
          location={location}
          availableCount={availableCount}
          requestError={requestError}
          onRequest={handleRequest}
          onDonate={handleDonate}
          donationEnabled={donable.length > 0}
          onReport={() => setReportOpen(true)}
          onSelectCentro={openCenterDetail}
          filter={mapFilter}
          filterCounts={mapFilterCounts}
          onToggleFilter={handleToggleFilter}
          roleLabel={centerAdmin ? 'Administrador de centro' : 'Ciudadano'}
          centerAction={centerAction}
        />
      )}

      {/* EP-03.F1.US1: the administrator's center. The dialogs only exist for
          that role; for a citizen none of them is ever mounted. */}
      {centerAdmin && (
        <>
          <CreateCenterDialog
            open={createCenterOpen}
            onOpenChange={setCreateCenterOpen}
            mapCenter={mapCenter}
            location={location}
            onSubmit={handleCreateCenter}
          />
          <AddSupplyDialog
            open={addSupplyOpen}
            onOpenChange={setAddSupplyOpen}
            existingNames={myCentro?.items.map((item) => item.nombre) ?? []}
            onSubmit={handleAddSupply}
          />
          <WithdrawSupplyDialog
            item={withdrawItem}
            onClose={() => setWithdrawItemId(null)}
            onSubmit={handleWithdrawSupply}
          />
        </>
      )}

      {donationOpen && detailCentro && (
        <DonationDialog
          centro={detailCentro}
          onConfirm={handleConfirmDonation}
          onClose={() => setDonationOpen(false)}
        />
      )}

      {acceptanceOpen && acceptedBy && (
        <AcceptancePopup ambulanceId={acceptedBy} unit={assignedUnit} onClose={closeAcceptance} />
      )}

      {/*
        `C.c5`: the arrival dialog asks for an answer and can be dismissed
        (Escape, outside click or "Cerrar") without confirming. It is NOT keyed:
        its open state is re-derived from the phase above, so a new request
        starts with a fresh dialog instead of inheriting a previous dismissal.
      */}
      {arrivalOpen && acceptedBy && (
        <ArrivalPopup
          unitId={acceptedBy}
          unit={assignedUnit}
          onConfirm={handleConfirmArrival}
          onClose={closeArrival}
        />
      )}

      {/* Task 250: "Reportar zona afectada" — the report dialog and its POST. */}
      <CitizenReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        mapCenter={mapCenter}
        location={location}
        onSubmit={handleReportSubmit}
      />

      {/*
        Location permission pop-up. It is mounted at PAGE level, not inside the
        report dialog: nesting one modal in another is bad UX, and this dialog
        already shares the page's single location watcher.
      */}
      <LocationPermissionDialog
        status={location.status}
        permission={location.permission}
        onRetry={location.retry}
      />
    </div>
  );
}
