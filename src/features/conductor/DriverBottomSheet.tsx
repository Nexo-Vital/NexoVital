import { Crosshair, MapPin, Navigation, Power, Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DeviceLocationState } from '@/features/geolocalizacion/use-device-location';
import {
  INSECURE_CONTEXT_MESSAGE,
  SIMULATED_START,
} from '@/features/geolocalizacion/use-device-location';
import { EMERGENCY_LEVEL_META } from '@/features/solicitudes/request-status';
import { cn } from '@/lib/utils';
import { DRIVER_STATUS_META, DRIVER_STATUS_ORDER, type DriverStatus } from './driver-status';
import type { Mission } from './use-solicitud-inbox';

interface DriverBottomSheetProps {
  online: boolean;
  status: DriverStatus;
  onStatusChange: (status: DriverStatus) => void;
  onGoOnline: () => void;
  onGoOffline: () => void;
  mission: Mission | null;
  location: DeviceLocationState;
}

function locationHint(location: DeviceLocationState): { text: string; tone: string } {
  switch (location.status) {
    case 'unsupported':
      return { text: INSECURE_CONTEXT_MESSAGE, tone: 'text-warning' };
    case 'denied':
      return {
        text: 'Location permission denied. Enable it in the browser settings or simulate a position.',
        tone: 'text-critical',
      };
    case 'unavailable':
      return {
        text: 'Location unavailable right now. Try again shortly or simulate.',
        tone: 'text-warning',
      };
    case 'granted':
      return { text: 'Live GPS position.', tone: 'text-ok' };
    default:
      return { text: 'Waiting for location permission…', tone: 'text-muted-foreground' };
  }
}

/** Uber-style driver sheet: status, mission and the simulation fallback. */
export function DriverBottomSheet({
  online,
  status,
  onStatusChange,
  onGoOnline,
  onGoOffline,
  mission,
  location,
}: DriverBottomSheetProps) {
  const hint = locationHint(location);
  const levelMeta = mission ? EMERGENCY_LEVEL_META[mission.nivel] : null;

  return (
    <section
      aria-label="Driver controls"
      className="absolute inset-x-0 bottom-0 z-[1100] flex max-h-[58dvh] flex-col rounded-t-xl border-t border-border bg-card shadow-lg"
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <span className="mx-auto h-1 w-10 rounded-full bg-border" aria-hidden />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Radio
              className={cn('size-4', online ? 'text-ok' : 'text-muted-foreground')}
              aria-hidden
            />
            <span className="font-semibold text-sm">Driver console</span>
          </div>
          <Badge
            variant="outline"
            className={cn('gap-1', online ? 'border-ok/40 text-ok' : 'border-border text-idle')}
          >
            <span
              className={cn('size-1.5 rounded-full', online ? 'bg-ok nv-pulse' : 'bg-idle')}
              aria-hidden
            />
            {online ? 'Online' : 'Offline'}
          </Badge>
        </div>

        {!online ? (
          <Button type="button" size="lg" onClick={onGoOnline} className="w-full">
            <Power className="size-4" aria-hidden />
            Go online
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={onGoOffline}>
            <Power className="size-4" aria-hidden />
            Go offline
          </Button>
        )}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="nv-label text-muted-foreground">My status</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {DRIVER_STATUS_ORDER.map((value) => {
              const meta = DRIVER_STATUS_META[value];
              const active = status === value;
              return (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={active}
                  onClick={() => onStatusChange(value)}
                  className={cn('justify-start gap-2', active && cn(meta.textClass, 'bg-accent'))}
                >
                  <span className={cn('size-2 rounded-full', meta.dotClass)} aria-hidden />
                  {meta.label}
                </Button>
              );
            })}
          </div>
        </fieldset>

        {mission && levelMeta && (
          <div className="flex flex-col gap-2 rounded-md border border-assign/40 bg-assign/5 p-3">
            <div className="flex items-center gap-2">
              <Navigation className="size-4 text-assign" aria-hidden />
              <span className="nv-label text-assign">Current mission</span>
              <Badge
                variant="outline"
                className={cn('ml-auto gap-1', levelMeta.borderClass, levelMeta.textClass)}
              >
                <span className={cn('size-1.5 rounded-full', levelMeta.dotClass)} aria-hidden />
                {levelMeta.label}
              </Badge>
            </div>
            <p className="font-medium text-sm">{mission.tipo}</p>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <MapPin className="size-3.5" aria-hidden />
                {mission.zonaId}
              </span>
              <span className="tabular ml-auto font-medium">ETA {mission.etaMinutes} min</span>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Crosshair className="size-4 text-muted-foreground" aria-hidden />
            <span className="nv-label text-muted-foreground">My position</span>
            {location.simulated && (
              <Badge variant="outline" className="ml-auto border-warning/50 text-warning">
                Simulated
              </Badge>
            )}
          </div>
          <p className={cn('text-xs', hint.tone)}>{hint.text}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={location.simulated ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => location.setSimulatedPosition(location.position ?? SIMULATED_START)}
            >
              {location.simulated ? 'Recenter simulation' : 'Simulate my position'}
            </Button>
            {location.simulated && (
              <Button type="button" variant="ghost" size="sm" onClick={location.clearSimulated}>
                Use device GPS
              </Button>
            )}
          </div>
          {location.simulated && (
            <p className="text-muted-foreground text-[11px]">
              Tap the map or drag the SIM marker to move. The position is published to /topic/flota
              as a simulated unit.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
