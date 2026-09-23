import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { CrueActions } from '@/features/crue/CrueActions';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useEmergencySync } from '@/features/emergencias/use-emergency-sync';
import { FleetManagerDialog } from '@/features/flota/FleetManagerDialog';
import { useFleetStore } from '@/features/flota/fleet-store';
import { PanelFlota } from '@/features/flota/PanelFlota';
import { useFleetSync } from '@/features/flota/use-fleet-sync';
import { MapCanvas } from '@/features/mapa/MapCanvas';
import { MapLayersControl } from '@/features/mapa/MapLayersControl';
import { MapLegend } from '@/features/mapa/MapLegend';
import { BOGOTA_CENTER } from '@/features/mapa/mapConfig';
import { useMapData } from '@/features/mapa/use-map-data';
import { PanelDetalle } from '@/features/solicitudes/PanelDetalle';
import { RegistroSolicitudes } from '@/features/solicitudes/RegistroSolicitudes';
import { type SolicitudRequestPayload, toSolicitud } from '@/features/solicitudes/solicitud-form';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { useSolicitudRegistrySync } from '@/features/solicitudes/use-solicitud-registry-sync';
import { RequireRole } from '@/features/usuarios/guards';
import { useSessionStore } from '@/features/usuarios/session';
import { useMockLoad } from '@/hooks/use-mock-load';
import { cn } from '@/lib/utils';
import {
  MOCK_AMBULANCIAS,
  MOCK_CENTROS_AYUDA,
  MOCK_EMERGENCIAS,
  MOCK_SOLICITUDES,
} from '@/mocks/fixtures';
import {
  DESTINATIONS,
  type EmergencyUpsertPayload,
  type FleetUnitDeletePayload,
  type FleetUnitUpsertPayload,
  getRealtimePort,
} from '@/shared/realtime';
import type {
  AmbulanceState,
  Ambulancia,
  CentroAyuda,
  Emergencia,
  RolUsuario,
  SolicitudAmbulancia,
  Ubicacion,
} from '@/types/domain';
import { SalaOperacionesDock } from './SalaOperacionesDock';

/** Only these roles see the incoming request registry. */
const COORDINATOR_ROLES: RolUsuario[] = ['ADMIN_CENTRO_AYUDA', 'ADMIN_PLATAFORMA'];

interface SalaOperacionesPageProps {
  ambulancias?: Ambulancia[];
  emergencias?: Emergencia[];
  solicitudes?: SolicitudAmbulancia[];
  centrosAyuda?: CentroAyuda[];
}

/**
 * CRUE operations room. Full-viewport grid: fleet rail, full-bleed map, context
 * rail and the request registry strip.
 *
 * Collections live in zustand stores hydrated from the props (fixtures by
 * default) and are then UPSERTed from realtime topics, so units and emergencies
 * created on another client appear here. Selection stays read-only: this
 * console never picks a request winner (rule C2, decided server-side).
 */
export default function SalaOperacionesPage({
  ambulancias = MOCK_AMBULANCIAS,
  emergencias = MOCK_EMERGENCIAS,
  solicitudes = MOCK_SOLICITUDES,
  centrosAyuda = MOCK_CENTROS_AYUDA,
}: SalaOperacionesPageProps) {
  const role = useSessionStore((state) => state.role);
  const fleetLoading = useMockLoad(450);
  const detailLoading = useMockLoad(700);
  const showRegistry = role !== null && COORDINATOR_ROLES.includes(role);

  const port = getRealtimePort();
  const fleetUnits = useFleetStore((state) => state.units);
  const emergencyItems = useEmergencyStore((state) => state.items);
  const solicitudItems = useSolicitudesStore((state) => state.items);

  // Hydrate the stores from the props; the sync hooks below then merge remote
  // changes on top without replacing locally created items.
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

  // Zones and centers come from the shared map source: the fixtures with the
  // demo flag on, `GET /api/v1/mapa` with it off (never a silent fallback).
  const mapa = useMapData(centrosAyuda);

  const [mapCenter, setMapCenter] = useState<Ubicacion>(BOGOTA_CENTER);
  const [fleetManagerOpen, setFleetManagerOpen] = useState(false);
  const [selectedAmbulanceId, setSelectedAmbulanceId] = useState<string | null>(null);
  const [selectedEmergencyId, setSelectedEmergencyId] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedCentroId, setSelectedCentroId] = useState<string | null>(null);

  const selectedAmbulance = useMemo(
    () => fleetUnits.find((item) => item.id === selectedAmbulanceId) ?? null,
    [fleetUnits, selectedAmbulanceId],
  );
  const selectedEmergency = useMemo(
    () => emergencyItems.find((item) => item.id === selectedEmergencyId) ?? null,
    [emergencyItems, selectedEmergencyId],
  );
  const selectedRequest = useMemo(
    () => solicitudItems.find((item) => item.id === selectedRequestId) ?? null,
    [solicitudItems, selectedRequestId],
  );
  const selectedCentro = useMemo(
    () => mapa.centros.find((item) => item.id === selectedCentroId) ?? null,
    [mapa.centros, selectedCentroId],
  );

  const focus: Ubicacion | null = useMemo(() => {
    if (selectedAmbulance) {
      return selectedAmbulance.ubicacion;
    }
    if (selectedEmergency) {
      return selectedEmergency.ubicacion;
    }
    if (selectedRequest) {
      return (
        emergencyItems.find((item) => item.id === selectedRequest.emergenciaId)?.ubicacion ?? null
      );
    }
    return null;
  }, [selectedAmbulance, selectedEmergency, selectedRequest, emergencyItems]);

  const selectAmbulance = (id: string) => {
    setSelectedAmbulanceId(id);
    setSelectedEmergencyId(null);
    setSelectedRequestId(null);
    setSelectedCentroId(null);
  };

  const selectEmergency = (id: string) => {
    setSelectedEmergencyId(id);
    setSelectedAmbulanceId(null);
    setSelectedRequestId(null);
    setSelectedCentroId(null);
  };

  const selectRequest = (id: string) => {
    setSelectedRequestId(id);
    setSelectedAmbulanceId(null);
    setSelectedEmergencyId(null);
    setSelectedCentroId(null);
  };

  const selectCentro = (id: string) => {
    setSelectedCentroId(id);
    setSelectedAmbulanceId(null);
    setSelectedEmergencyId(null);
    setSelectedRequestId(null);
  };

  // --- Mutations: update the store, then mirror them on the realtime topic. ---

  const handleCreateUnit = useCallback(
    (unit: Ambulancia) => {
      useFleetStore.getState().upsert(unit);
      port?.publish(DESTINATIONS.flota, {
        type: 'fleet.upsert',
        unit,
      } satisfies FleetUnitUpsertPayload);
      toast(`Unit ${unit.id} created`);
    },
    [port],
  );

  const handleUpdateUnit = useCallback(
    (id: string, patch: { driverName: string; estado: AmbulanceState }) => {
      const existing = useFleetStore.getState().units.find((item) => item.id === id);
      if (!existing) {
        return;
      }
      const unit: Ambulancia = { ...existing, ...patch };
      useFleetStore.getState().upsert(unit);
      port?.publish(DESTINATIONS.flota, {
        type: 'fleet.upsert',
        unit,
      } satisfies FleetUnitUpsertPayload);
      toast(`Unit ${id} updated`);
    },
    [port],
  );

  const handleDeleteUnit = useCallback(
    (id: string) => {
      useFleetStore.getState().remove(id);
      port?.publish(DESTINATIONS.flota, {
        type: 'fleet.delete',
        ambulanceId: id,
      } satisfies FleetUnitDeletePayload);
      toast(`Unit ${id} removed`);
    },
    [port],
  );

  const handleCreateEmergency = useCallback(
    (emergency: Emergencia) => {
      useEmergencyStore.getState().upsert(emergency);
      port?.publish(DESTINATIONS.emergencias, {
        type: 'emergency.upsert',
        emergency,
      } satisfies EmergencyUpsertPayload);
      toast(`Emergency ${emergency.id} reported`);
    },
    [port],
  );

  const handleCreateRequest = useCallback(
    (payload: SolicitudRequestPayload) => {
      useSolicitudesStore.getState().upsert(toSolicitud(payload));
      port?.publish(DESTINATIONS.solicitudes, payload);
      const count = payload.notifiedCount ?? payload.notificadas.length;
      toast(
        payload.type === 'solicitud.direct'
          ? `Direct request sent to ${payload.targetAmbulanceId}`
          : `Broadcast to ${count} units`,
      );
    },
    [port],
  );

  return (
    <div
      className={cn(
        // Mobile: single column, the map grows and the dock sits below it.
        'flex h-full min-h-0 w-full flex-col',
        // Desktop: the unchanged 3-column console plus the registry strip.
        'lg:grid lg:grid-cols-[240px_minmax(0,1fr)_300px] xl:grid-cols-[280px_minmax(0,1fr)_340px]',
        showRegistry ? 'lg:grid-rows-[minmax(0,1fr)_168px]' : 'lg:grid-rows-[minmax(0,1fr)]',
      )}
    >
      <div className="hidden min-h-0 lg:block">
        <PanelFlota
          ambulancias={fleetUnits}
          selectedId={selectedAmbulanceId}
          onSelect={selectAmbulance}
          loading={fleetLoading}
          onManage={() => setFleetManagerOpen(true)}
        />
      </div>

      <div className="relative min-h-0 flex-1 lg:flex-none">
        <MapCanvas
          ambulancias={fleetUnits}
          emergencias={emergencyItems}
          centros={mapa.centros}
          zonas={mapa.zonas}
          selectedAmbulanceId={selectedAmbulanceId}
          selectedCentroId={selectedCentroId}
          focus={focus}
          onCenterChange={setMapCenter}
          onSelectAmbulance={selectAmbulance}
          onSelectEmergency={selectEmergency}
          onSelectCentro={selectCentro}
        />
        <MapLayersControl className="hidden lg:block" />
        <MapLegend />
        <CrueActions
          className="absolute top-3 left-3 z-[650]"
          emergencies={emergencyItems}
          fleet={fleetUnits}
          mapCenter={mapCenter}
          userRole={role}
          onCreateEmergency={handleCreateEmergency}
          onCreateRequest={handleCreateRequest}
        />
      </div>

      <div className="hidden min-h-0 lg:block">
        <PanelDetalle
          selectedAmbulance={selectedAmbulance}
          selectedEmergency={selectedEmergency}
          selectedRequest={selectedRequest}
          centrosAyuda={mapa.centros}
          selectedCentro={selectedCentro}
          loading={detailLoading}
        />
      </div>

      {showRegistry && (
        <RequireRole roles={COORDINATOR_ROLES}>
          <div className="hidden min-h-0 border-t border-border bg-card lg:col-span-3 lg:block">
            <RegistroSolicitudes
              solicitudes={solicitudItems}
              selectedId={selectedRequestId}
              onSelect={selectRequest}
            />
          </div>
        </RequireRole>
      )}

      <SalaOperacionesDock
        ambulancias={fleetUnits}
        selectedAmbulanceId={selectedAmbulanceId}
        onSelectAmbulance={selectAmbulance}
        onManageFleet={() => setFleetManagerOpen(true)}
        fleetLoading={fleetLoading}
        selectedAmbulance={selectedAmbulance}
        selectedEmergency={selectedEmergency}
        selectedRequest={selectedRequest}
        centrosAyuda={mapa.centros}
        selectedCentro={selectedCentro}
        detailLoading={detailLoading}
        solicitudes={solicitudItems}
        selectedRequestId={selectedRequestId}
        onSelectRequest={selectRequest}
        showRegistry={showRegistry}
      />

      <FleetManagerDialog
        open={fleetManagerOpen}
        onOpenChange={setFleetManagerOpen}
        units={fleetUnits}
        mapCenter={mapCenter}
        onCreate={handleCreateUnit}
        onUpdate={handleUpdateUnit}
        onDelete={handleDeleteUnit}
      />
    </div>
  );
}
