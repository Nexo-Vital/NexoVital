import { type FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  buildEmergency,
  type EmergencyFormErrors,
  type EmergencyFormValues,
  nextEmergencyId,
  validateEmergencyForm,
} from '@/features/emergencias/emergency-form';
import { EMERGENCY_LEVEL_META } from '@/features/solicitudes/request-status';
import type { Emergencia, EmergencyLevel, Ubicacion } from '@/types/domain';

const LEVEL_OPTIONS: EmergencyLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const EMPTY_FORM: EmergencyFormValues = {
  nivel: 'MEDIUM',
  zonaId: '',
  descripcion: '',
  lat: '',
  lng: '',
};

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface EmergencyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emergencies: Emergencia[];
  mapCenter: Ubicacion;
  onCreate: (emergency: Emergencia) => void;
}

/** Report a new emergency. Validates required fields and publishes upstream. */
export function EmergencyFormDialog({
  open,
  onOpenChange,
  emergencies,
  mapCenter,
  onCreate,
}: EmergencyFormDialogProps) {
  const [values, setValues] = useState<EmergencyFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<EmergencyFormErrors>({});

  useEffect(() => {
    if (!open) {
      return;
    }
    setValues(EMPTY_FORM);
    setErrors({});
  }, [open]);

  const useMapCenter = () => {
    setValues((current) => ({
      ...current,
      lat: String(mapCenter.lat),
      lng: String(mapCenter.lng),
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateEmergencyForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const emergency = buildEmergency(values, nextEmergencyId(emergencies));
    if (!emergency) {
      return;
    }
    onCreate(emergency);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="emergency-form-desc">
        <DialogHeader>
          <DialogTitle>Report emergency</DialogTitle>
          <DialogDescription id="emergency-form-desc">
            Report a new emergency. It is published on /topic/emergencias and appears on every
            connected map.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="emergency-level" className="nv-label text-muted-foreground">
              Level
            </label>
            <select
              id="emergency-level"
              name="nivel"
              value={values.nivel}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  nivel: event.target.value as EmergencyLevel,
                }))
              }
              className={FIELD_CLASS}
            >
              {LEVEL_OPTIONS.map((level) => (
                <option key={level} value={level}>
                  {EMERGENCY_LEVEL_META[level].label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="emergency-zone" className="nv-label text-muted-foreground">
              Zone
            </label>
            <input
              id="emergency-zone"
              name="zonaId"
              value={values.zonaId}
              onChange={(event) =>
                setValues((current) => ({ ...current, zonaId: event.target.value }))
              }
              aria-invalid={Boolean(errors.zonaId)}
              className={FIELD_CLASS}
            />
            {errors.zonaId && (
              <p role="alert" className="text-critical text-[11px]">
                {errors.zonaId}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="emergency-description" className="nv-label text-muted-foreground">
              Description
            </label>
            <textarea
              id="emergency-description"
              name="descripcion"
              rows={3}
              value={values.descripcion}
              onChange={(event) =>
                setValues((current) => ({ ...current, descripcion: event.target.value }))
              }
              aria-invalid={Boolean(errors.descripcion)}
              className={`${FIELD_CLASS} h-auto py-1.5`}
            />
            {errors.descripcion && (
              <p role="alert" className="text-critical text-[11px]">
                {errors.descripcion}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="emergency-lat" className="nv-label text-muted-foreground">
                Latitude
              </label>
              <input
                id="emergency-lat"
                name="lat"
                inputMode="decimal"
                value={values.lat}
                onChange={(event) =>
                  setValues((current) => ({ ...current, lat: event.target.value }))
                }
                aria-invalid={Boolean(errors.lat)}
                className={FIELD_CLASS}
              />
              {errors.lat && (
                <p role="alert" className="text-critical text-[11px]">
                  {errors.lat}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="emergency-lng" className="nv-label text-muted-foreground">
                Longitude
              </label>
              <input
                id="emergency-lng"
                name="lng"
                inputMode="decimal"
                value={values.lng}
                onChange={(event) =>
                  setValues((current) => ({ ...current, lng: event.target.value }))
                }
                aria-invalid={Boolean(errors.lng)}
                className={FIELD_CLASS}
              />
              {errors.lng && (
                <p role="alert" className="text-critical text-[11px]">
                  {errors.lng}
                </p>
              )}
            </div>
          </div>

          <Button type="button" size="sm" variant="outline" onClick={useMapCenter}>
            Use map center
          </Button>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Report emergency</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
