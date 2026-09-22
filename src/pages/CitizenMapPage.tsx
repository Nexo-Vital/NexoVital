import { useEffect, useMemo } from 'react';
import { CitizenMapLegend } from '@/features/ciudadano/CitizenMapLegend';
import { CitizenRail } from '@/features/ciudadano/CitizenRail';
import { CitizenSummaryChips } from '@/features/ciudadano/CitizenSummaryChips';
import {
  CITIZEN_FALLBACK_POSITION,
  countCentersByLevel,
  nearbyAmbulances,
} from '@/features/ciudadano/citizen-view';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useEmergencySync } from '@/features/emergencias/use-emergency-sync';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useFleetSync } from '@/features/flota/use-fleet-sync';
import { useDeviceLocation } from '@/features/geolocalizacion/use-device-location';
import { MapCanvas, type SelfMarker } from '@/features/mapa/MapCanvas';
import { useSolicitudesStore } from '@/features/solicitudes/solicitudes-store';
import { useSolicitudRegistrySync } from '@/features/solicitudes/use-solicitud-registry-sync';
import {
  MOCK_AMBULANCIAS,
  MOCK_CENTROS_AYUDA,
  MOCK_EMERGENCIAS,
  MOCK_SOLICITUDES,
} from '@/mocks/fixtures';
import { getRealtimePort, type RealtimePort } from '@/shared/realtime';
import type { Ambulancia, CentroAyuda, Emergencia, SolicitudAmbulancia } from '@/types/domain';

/**
 * Stable empty list: the citizen map deliberately draws no emergency pins (the
 * mockup's C.c2 shows only centers, units and "Tú"), and a module-level constant
 * keeps the MapCanvas memo from invalidating on every render.
 */
const NO_EMERGENCIES: Emergencia[] = [];

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

  const fleet = useFleetStore((state) => state.units);
  const location = useDeviceLocation();

  // Device position when the browser grants it; a Suba fallback otherwise, so
  // the "Tú" marker (and the distances in the rail) always have an origin.
  const selfPosition = location.position ?? CITIZEN_FALLBACK_POSITION;

  const counts = useMemo(() => countCentersByLevel(centrosAyuda), [centrosAyuda]);
  const nearby = useMemo(() => nearbyAmbulances(fleet, selfPosition), [fleet, selfPosition]);
  const self: SelfMarker = useMemo(
    () => ({
      position: selfPosition,
      heading: location.heading,
      simulated: location.simulated,
      label: 'Tú',
    }),
    [selfPosition, location.heading, location.simulated],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto bg-nv-mint p-3 text-nv-navy lg:grid lg:grid-cols-[minmax(0,1fr)_344px] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-5 lg:overflow-hidden lg:p-5">
      <header className="flex flex-wrap items-end justify-between gap-3 lg:col-span-2">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Mapa de operación</h1>
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
        aria-label="Mapa de centros de acopio y ambulancias"
        className="relative h-[52dvh] min-h-[300px] shrink-0 overflow-hidden rounded-nv-lg shadow-nv-card lg:h-auto lg:min-h-0"
      >
        <MapCanvas
          ambulancias={fleet}
          emergencias={NO_EMERGENCIES}
          centros={centrosAyuda}
          center={selfPosition}
          self={self}
          onSelectAmbulance={() => undefined}
          onSelectEmergency={() => undefined}
        />
        <CitizenMapLegend counts={counts} units={fleet} />
      </section>

      <CitizenRail nearby={nearby} centros={centrosAyuda} />
    </div>
  );
}
