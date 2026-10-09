import { Crosshair } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type DeviceLocationState,
  INSECURE_CONTEXT_MESSAGE,
  SIMULATED_START,
} from './use-device-location';

/** Simulation is a development aid only: production builds (main) never show it. */
export const SIMULATION_ENABLED = import.meta.env.DEV;

/** Spanish position hint for the simulation fallback, one per device status. */
function locationHint(location: DeviceLocationState): { text: string; tone: string } {
  switch (location.status) {
    case 'unsupported':
      return { text: INSECURE_CONTEXT_MESSAGE, tone: 'text-warning' };
    case 'denied':
      return {
        text: 'Permiso de ubicación denegado. Actívalo en los ajustes del navegador o simula una posición.',
        tone: 'text-critical',
      };
    case 'unavailable':
      return {
        text: 'La ubicación no está disponible ahora. Inténtalo de nuevo en un momento o simula una posición.',
        tone: 'text-warning',
      };
    case 'granted':
      return { text: 'Posición GPS en vivo.', tone: 'text-ok' };
    default:
      return { text: 'Esperando el permiso de ubicación…', tone: 'text-muted-foreground' };
  }
}

/**
 * "Mi posición" simulation control, shared by the driver and citizen rails so
 * both screens offer the SAME vocabulary and behaviour: start the simulation,
 * recentre it and fall back to the device GPS. The caller owns the card shell
 * (the driver nests it in "Tu ambulancia", the citizen in its own panel), so the
 * inner content — chip, hint, buttons and note — cannot drift between screens.
 */
export function LocationSimulationControls({
  location,
  note,
}: {
  location: DeviceLocationState;
  /** Extra honest detail shown while simulating (platform-specific). */
  note?: string;
}) {
  const hint = locationHint(location);
  return (
    <>
      <div className="flex items-center gap-2">
        <Crosshair className="size-4 text-nv-navy-400" aria-hidden />
        <span className="nv-label text-nv-navy-400">Mi posición</span>
        {location.simulated && (
          <span className="ml-auto shrink-0 rounded-nv-pill border border-nv-amber px-2.5 py-1 font-semibold text-nv-amber text-xs">
            Simulada
          </span>
        )}
      </div>
      <p className={cn('text-xs', hint.tone)}>{hint.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => location.setSimulatedPosition(location.position ?? SIMULATED_START)}
          className={cn(
            'inline-flex items-center justify-center rounded-nv-md px-3 py-2 font-semibold text-xs',
            location.simulated
              ? 'bg-nv-navy text-white'
              : 'border-[1.5px] border-nv-line bg-white text-nv-navy',
          )}
        >
          {location.simulated ? 'Recentrar simulación' : 'Simular posición'}
        </button>
        {location.simulated && (
          <button
            type="button"
            onClick={location.clearSimulated}
            className="inline-flex items-center justify-center rounded-nv-md px-3 py-2 font-semibold text-nv-navy-400 text-xs"
          >
            Usar GPS del dispositivo
          </button>
        )}
      </div>
      {location.simulated && note && <p className="text-nv-navy-400 text-[11px]">{note}</p>}
    </>
  );
}
