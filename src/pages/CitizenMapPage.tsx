import { Check, HandHeart } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { AcceptancePopup } from '@/features/ciudadano/AcceptancePopup';
import { ArrivalPopup } from '@/features/ciudadano/ArrivalPopup';
import { CitizenMapLegend } from '@/features/ciudadano/CitizenMapLegend';
import { CitizenRail } from '@/features/ciudadano/CitizenRail';
import { CitizenRequestRail } from '@/features/ciudadano/CitizenRequestRail';
import { CitizenSummaryChips } from '@/features/ciudadano/CitizenSummaryChips';
import { citizenSceneLabel, countAvailableUnits } from '@/features/ciudadano/citizen-request';
import {
  useCitizenRequestStore,
  useCitizenRequestSync,
} from '@/features/ciudadano/citizen-request-store';
import {
  CITIZEN_FALLBACK_POSITION,
  citizenUnitStatus,
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
  type ReportarEmergenciaInput,
  reportarEmergencia,
} from '@/features/emergencias/emergency-api';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useEmergencySync } from '@/features/emergencias/use-emergency-sync';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useFleetSync } from '@/features/flota/use-fleet-sync';
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
import { registrarDonacion } from '@/features/recursos/inventory-api';
import { useInventarioStore, withInventario } from '@/features/recursos/inventory-store';
import { centroSemaforo } from '@/features/recursos/traffic-light';
import { useInventario } from '@/features/recursos/use-inventario';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { useSolicitudRegistrySync } from '@/features/solicitudes/use-solicitud-registry-sync';
import { etaMinutes } from '@/lib/geo';
import {
  MOCK_AMBULANCIAS,
  MOCK_CENTROS_AYUDA,
  MOCK_EMERGENCIAS,
  MOCK_SOLICITUDES,
} from '@/mocks/fixtures';
import { isDemoMode } from '@/services/apiClient';
import {
  DESTINATIONS,
  type EmergencyUpsertPayload,
  getRealtimePort,
  type RealtimePort,
} from '@/shared/realtime';
import type {
  Ambulancia,
  CentroAyuda,
  Emergencia,
  SolicitudAmbulancia,
  Ubicacion,
} from '@/types/domain';

/**
 * Stable empty list: the citizen map deliberately draws no emergency pins (the
 * mockup's C.c2 shows only centers, units and "Tú"), and a module-level constant
 * keeps the MapCanvas memo from invalidating on every render.
 */
const NO_EMERGENCIES: Emergencia[] = [];

/** Stable empty id list: keeps the MapCanvas memo props stable while idle. */
const NO_UNIT_IDS: readonly string[] = [];

/**
 * Confirmation raised once a citizen report succeeds, in both modes. It is
 * honest with a backend (the emergency was created) and in the demo build (it was
 * registered and published over the relay): it never claims a server round-trip.
 */
const REPORT_SUCCESS_MESSAGE =
  'Reporte registrado. Los centros de ayuda cercanos lo verán en el mapa.';

interface CitizenMapPageProps {
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
 * Data path is identical to the CRUE room: fixtures hydrate the zustand stores
 * and the realtime layer UPSERTs remote changes on top. No network call is added
 * here, which is what makes the same screen work against the real backend and in
 * the demo build (whose network path is compiled out).
 */
export default function CitizenMapPage({
  ambulancias = MOCK_AMBULANCIAS,
  emergencias = MOCK_EMERGENCIAS,
  solicitudes = MOCK_SOLICITUDES,
  centrosAyuda = MOCK_CENTROS_AYUDA,
  port = getRealtimePort(),
}: CitizenMapPageProps) {
  useEffect(() => {
    useFleetStore.getState().hydrate(ambulancias);
  }, [ambulancias]);
  useEffect(() => {
    useEmergencyStore.getState().hydrate(emergencias);
  }, [emergencias]);
  useEffect(() => {
    useSolicitudesStore.getState().hydrate(solicitudes);
  }, [solicitudes]);

  useFleetSync(port);
  useEmergencySync(port);
  useSolicitudRegistrySync(port);
  useCitizenRequestSync(port);

  const fleet = useFleetStore((state) => state.units);
  const location = useDeviceLocation();
  // Zones and centers come from the shared map source: the fixtures with the
  // demo flag on, `GET /api/v1/mapa` with it off (never a silent fallback).
  const mapa = useMapData(centrosAyuda);

  // Inventory (EP-03): with the demo flag off the items come from the backend
  // (REST snapshot + `/topic/suministros` upserts); with it on the fixtures
  // already carry them, so the store stays empty and the merge is a no-op.
  useInventario(mapa.centros, port);
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
  const mapLayers = useMemo(
    () => ({ zonas: mapa.zonas, centros, ambulancias: fleet }),
    [mapa.zonas, centros, fleet],
  );
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

  const requestPhase = useCitizenRequestStore((state) => state.phase);
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
  // whenever the device position changes, so "usar el centro del mapa" is honest.
  const [reportOpen, setReportOpen] = useState(false);
  const [mapCenter, setMapCenter] = useState<Ubicacion>(selfPosition);
  useEffect(() => {
    setMapCenter(selfPosition);
  }, [selfPosition]);

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
        ? fleet.filter((unit) => citizenUnitStatus(unit.estado) !== 'free').map((unit) => unit.id)
        : NO_UNIT_IDS,
    [searching, fleet],
  );

  const handleRequest = useCallback(() => {
    // A request takes over the rail, so any open donation picker is dropped.
    setPickerOpen(false);
    useCitizenRequestStore.getState().start({
      port,
      units: useFleetStore.getState().units,
      origin: selfPosition,
    });
  }, [port, selfPosition]);

  const handleCancel = useCallback(() => {
    useCitizenRequestStore.getState().cancel(port);
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
  const openCenterDetail = useCallback((id: string) => {
    setPickerOpen(false);
    setDetailCentroId(id);
    setLastDonation(null);
  }, []);

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
        const item = await registrarDonacion(detailCentro.id, itemId, amount);
        useInventarioStore.getState().upsert(item);
        setLastDonation({ centroId: detailCentro.id, itemId, amount, beforeCenterLevel });
        setDonationOpen(false);
      } catch (error) {
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
  // a visual connector, not a calculated route (no routing engine in this build).
  const acceptanceConnector: RequestConnector | null = useMemo(
    () => (assignedUnit ? { from: assignedUnit.ubicacion, to: selfPosition, dashed: false } : null),
    [assignedUnit, selfPosition],
  );

  // The assigned unit's marker carries its computed ETA label ("A-07 · 5 min").
  const ambulanceLabels = useMemo(
    () =>
      assignedUnit
        ? {
            [assignedUnit.id]: `${assignedUnit.id} · ${etaMinutes(assignedUnit.ubicacion, selfPosition)} min`,
          }
        : undefined,
    [assignedUnit, selfPosition],
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
  const showDetail = requestPhase === 'idle' && detailCentro !== null;

  const title =
    detailCentro && showDetail
      ? 'Centro de acopio'
      : searching
        ? 'Pidiendo ambulancia'
        : accepted
          ? 'Tu ambulancia va en camino'
          : arrived
            ? 'Tu ambulancia llegó'
            : closed
              ? 'Solicitud atendida'
              : 'Mapa de operación';
  const subtitle =
    detailCentro && showDetail
      ? detailDonation
        ? `El semáforo de ${detailCentro.nombre} se actualizó para todos`
        : `Seleccionaste ${detailCentro.nombre} en el mapa`
      : searching || accepted || arrived
        ? citizenSceneLabel(selfPosition, { fallback: usingFallbackPosition })
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
          emergencias={NO_EMERGENCIES}
          centros={visibleMapLayers.centros}
          zonas={visibleMapLayers.zonas}
          center={selfPosition}
          focus={showDetail && detailCentro ? detailCentro.ubicacion : null}
          self={self}
          selectedAmbulanceId={assigned ? acceptedBy : null}
          selectedCentroId={detailCentro?.id ?? null}
          changedCentroId={detailDonation?.centroId ?? null}
          selfRings={searching}
          notifiedAmbulanceIds={searching ? notifiedIds : NO_UNIT_IDS}
          dimmedAmbulanceIds={dimmedIds}
          requestConnector={acceptanceConnector}
          ambulanceLabels={ambulanceLabels}
          onCenterChange={setMapCenter}
          onSelectAmbulance={() => undefined}
          onSelectEmergency={() => undefined}
          onSelectCentro={requestPhase === 'idle' ? openCenterDetail : undefined}
        />
        <CitizenMapLegend counts={counts} units={fleet} />

        {/* `C.c6`: the closing toast. It exists only once the request is closed. */}
        {closed && (
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
          onCancel={handleCancel}
          onBackToMap={handleBackToMap}
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
          availableCount={availableCount}
          onRequest={handleRequest}
          onDonate={handleDonate}
          donationEnabled={donable.length > 0}
          onReport={() => setReportOpen(true)}
          onSelectCentro={openCenterDetail}
          filter={mapFilter}
          filterCounts={mapFilterCounts}
          onToggleFilter={handleToggleFilter}
        />
      )}

      {donationOpen && detailCentro && (
        <DonationDialog
          centro={detailCentro}
          onConfirm={handleConfirmDonation}
          onClose={() => setDonationOpen(false)}
        />
      )}

      {acceptanceOpen && acceptedBy && (
        <AcceptancePopup ambulanceId={acceptedBy} onClose={closeAcceptance} />
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
    </div>
  );
}
