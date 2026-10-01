import { MapPin, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  GeolocationStatus,
  LocationPermissionState,
} from '@/features/geolocalizacion/use-device-location';

interface LocationPermissionDialogProps {
  /** Status the page's `useDeviceLocation()` reports. */
  status: GeolocationStatus;
  /**
   * Real permission state. `denied` only adds one short line pointing at the
   * browser settings: the app cannot reopen its native prompt for that origin,
   * but it still offers the retry, because the browser decides whether to ask.
   */
  permission: LocationPermissionState;
  /** Re-requests the location (the hook's `retry`). */
  onRetry: () => void;
}

/**
 * Pop-up shown when the citizen or the driver does not grant the location
 * permission.
 *
 * The app ALWAYS re-asks: "Volver a pedir" is present in every branch and
 * re-arms the geolocation request through the hook's `retry`. Whether the
 * browser shows its native prompt is the browser's decision, not the app's, so
 * the dialog does not pretend to know.
 *
 * The only honest difference is copy: when the real permission state is
 * `denied` (the user picked "Block"), the browser cannot re-show its prompt
 * until the user changes the site setting, so the dialog adds one short line
 * pointing at those settings. `prompt` and `unknown` need no extra line.
 *
 * It appears once per denial event and is fully dismissible, so the map keeps
 * working with its simulated-position fallback.
 *
 * It is a NON-modal corner notice: no scrim, no focus trap, rendered at the
 * bottom-right. The rest of the app (sidebar, map, rail) stays visible and
 * clickable while the notice is open.
 */
export function LocationPermissionDialog({
  status,
  permission,
  onRetry,
}: LocationPermissionDialogProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Opening depends on the STATUS, so a denial raises the dialog exactly once.
    // Dismissing it leaves `status` unchanged, so the effect does not run again
    // and the dialog stays closed until a new denial (a new status transition).
    if (status === 'denied') {
      setOpen(true);
      return;
    }
    if (status === 'granted') {
      setOpen(false);
    }
  }, [status]);

  const handleRetry = useCallback(() => {
    // Close so the native prompt (when it can appear) is not hidden behind us.
    setOpen(false);
    onRetry();
  }, [onRetry]);

  const blocked = permission === 'denied';

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogContent
        aria-describedby="location-permission-desc"
        showOverlay={false}
        className="top-auto right-4 bottom-4 left-auto w-[min(24rem,calc(100vw-2rem))] translate-x-0 translate-y-0"
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span
              className={
                blocked
                  ? 'grid size-9 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive'
                  : 'grid size-9 shrink-0 place-items-center rounded-full bg-nv-mint text-nv-navy'
              }
              aria-hidden
            >
              {blocked ? <ShieldAlert className="size-4" /> : <MapPin className="size-4" />}
            </span>
            <DialogTitle>Permiso de ubicación</DialogTitle>
          </div>
          <DialogDescription id="location-permission-desc">
            Necesitamos tu ubicación para mostrarte tu posición en el mapa y ordenar las ambulancias
            y los centros más cercanos.
          </DialogDescription>
        </DialogHeader>

        {blocked && (
          <p className="text-muted-foreground text-xs">
            Tu navegador tiene el permiso bloqueado para este sitio: habilitalo desde sus ajustes y
            recargá.
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Ahora no
          </Button>
          <Button type="button" onClick={handleRetry}>
            Volver a pedir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
