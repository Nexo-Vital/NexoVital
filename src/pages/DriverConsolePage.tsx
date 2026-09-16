import { useCallback, useEffect, useMemo, useState } from 'react';
import { DriverBottomSheet } from '@/features/conductor/DriverBottomSheet';
import { resolveDriverAmbulanceId } from '@/features/conductor/driver-session';
import { DRIVER_STATUS_META, type DriverStatus } from '@/features/conductor/driver-status';
import { IncomingRequestOverlay } from '@/features/conductor/IncomingRequestOverlay';
import { useSolicitudInbox } from '@/features/conductor/use-solicitud-inbox';
import { useEmergencyStore } from '@/features/emergencias/emergency-store';
import { useEmergencySync } from '@/features/emergencias/use-emergency-sync';
import { useFleetStore } from '@/features/flota/fleet-store';
import { useFleetSync } from '@/features/flota/use-fleet-sync';
import { useDeviceLocation } from '@/features/geolocalizacion/use-device-location';
import { MapCanvas } from '@/features/mapa/MapCanvas';
import { BOGOTA_CENTER } from '@/features/mapa/mapConfig';
import { useSessionStore } from '@/features/usuarios/session';
import { distanceKm, etaMinutes } from '@/lib/geo';
import { MOCK_AMBULANCIAS, MOCK_EMERGENCIAS } from '@/mocks/fixtures';
import {
  DESTINATIONS,
  getRealtimePort,
  type LiveUnitPayload,
  type RealtimePort,
} from '@/shared/realtime';

interface DriverConsolePageProps {
  /** Injectable for tests; defaults to the app realtime port. */
  port?: RealtimePort | null;
  /** The unit this driver drives; defaults to the mock session mapping. */
  ambulanceId?: string;
}

/**
 * Mobile-first driver console (Uber-like): full-screen map centred on the
 * driver plus a bottom sheet with status, mission and the simulation fallback.
 *
 * C2: Accept is a BID. This screen never decides a winner; it publishes the
 * accept and renders whatever the server-side arbiter answers.
 */
export default function DriverConsolePage({
  port = getRealtimePort(),
  ambulanceId,
}: DriverConsolePageProps) {
  const userId = useSessionStore((state) => state.user?.id);
  const unitId = ambulanceId ?? resolveDriverAmbulanceId(userId);

  const location = useDeviceLocation();
  const [online, setOnline] = useState(false);
  const [status, setStatus] = useState<DriverStatus>('OFF_DUTY');
  const [hasCentered, setHasCentered] = useState(false);

  const inbox = useSolicitudInbox(port, unitId, location.position);

  // Shared stores: emergencies reported and units created on another client
  // show up on the driver map too (UPSERT semantics).
  useEffect(() => {
    useFleetStore.getState().hydrate(MOCK_AMBULANCIAS);
    useEmergencyStore.getState().hydrate(MOCK_EMERGENCIAS);
  }, []);
  useFleetSync(port);
  useEmergencySync(port);

  const fleetUnits = useFleetStore((state) => state.units);
  const emergencies = useEmergencyStore((state) => state.items);

  useEffect(() => {
    if (!hasCentered && location.position) {
      setHasCentered(true);
    }
  }, [hasCentered, location.position]);

  // Report this unit on /topic/flota while online so the CRUE map tracks it.
  const { position, heading, simulated } = location;
  useEffect(() => {
    if (!online || !port || !position) {
      return;
    }
    const payload: LiveUnitPayload = {
      ambulanceId: unitId,
      ubicacion: position,
      estado: DRIVER_STATUS_META[status].estado,
      heading,
      source: simulated ? 'simulated' : 'device',
    };
    port.publish(DESTINATIONS.flota, payload);
  }, [online, port, unitId, position, heading, simulated, status]);

  const goOnline = useCallback(() => {
    setOnline(true);
    setStatus((current) => (current === 'OFF_DUTY' ? 'AVAILABLE' : current));
  }, []);

  const goOffline = useCallback(() => {
    setOnline(false);
    setStatus('OFF_DUTY');
  }, []);

  const fleet = useMemo(
    () => fleetUnits.filter((unit) => unit.id !== unitId),
    [fleetUnits, unitId],
  );

  const overlayDistance =
    inbox.broadcast && location.position
      ? distanceKm(location.position, inbox.broadcast.escena)
      : null;
  const overlayEta =
    inbox.broadcast && location.position
      ? etaMinutes(location.position, inbox.broadcast.escena)
      : null;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <MapCanvas
        ambulancias={fleet}
        emergencias={emergencies}
        center={location.position ?? BOGOTA_CENTER}
        focus={hasCentered ? null : location.position}
        self={
          location.position
            ? {
                position: location.position,
                heading: location.heading,
                simulated: location.simulated,
              }
            : null
        }
        onMapClick={location.simulated ? location.setSimulatedPosition : undefined}
        onSelfDragEnd={location.simulated ? location.setSimulatedPosition : undefined}
        onSelectAmbulance={() => undefined}
        onSelectEmergency={() => undefined}
      />

      {inbox.broadcast && inbox.deadlineMs !== null && (
        <IncomingRequestOverlay
          broadcast={inbox.broadcast}
          phase={inbox.phase}
          outcomeMessage={inbox.outcomeMessage}
          deadlineMs={inbox.deadlineMs}
          windowMs={inbox.windowMs}
          distanceKm={overlayDistance}
          etaMin={overlayEta}
          onAccept={inbox.accept}
          onReject={inbox.reject}
          onTimeout={inbox.notifyTimeout}
        />
      )}

      <DriverBottomSheet
        online={online}
        status={status}
        onStatusChange={setStatus}
        onGoOnline={goOnline}
        onGoOffline={goOffline}
        mission={inbox.mission}
        location={location}
      />
    </div>
  );
}
