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
  buildCitizenReportInput,
  type CitizenReportErrors,
  type CitizenReportValues,
  MAX_DESCRIPCION,
  validateCitizenReport,
} from '@/features/emergencias/citizen-report-form';
import type { ReportarEmergenciaInput } from '@/features/emergencias/emergency-api';
import {
  INSECURE_CONTEXT_MESSAGE,
  useDeviceLocation,
} from '@/features/geolocalizacion/use-device-location';
import type { EmergencyLevel, Ubicacion } from '@/types/domain';

const LEVEL_OPTIONS: EmergencyLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * Spanish labels for the citizen dialog. Severity colours stay in
 * `EMERGENCY_LEVEL_META` (shared, one source) and its labels are English because
 * the CRUE UI is English; the citizen UI is Spanish, so only the label differs.
 */
const LEVEL_LABELS: Record<EmergencyLevel, string> = {
  LOW: 'Bajo',
  MEDIUM: 'Medio',
  HIGH: 'Alto',
  CRITICAL: 'Crítico',
};

const EMPTY_FORM: CitizenReportValues = {
  nivel: 'MEDIUM',
  descripcion: '',
  lat: '',
  lng: '',
};

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface CitizenReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The point the citizen has on screen; offered as "Use map center" (D3). */
  mapCenter: Ubicacion;
  /** Publishes the report (POST with backend, local publish in demo mode). */
  onSubmit: (input: ReportarEmergenciaInput) => Promise<void>;
}

/**
 * Citizen "report an affected zone" dialog. Three location sources (D3): the map
 * center, the device GPS and manual lat/lng. GPS is a shortcut, never a gate: a
 * missing permission shows its message without blocking the report.
 */
export function CitizenReportDialog({
  open,
  onOpenChange,
  mapCenter,
  onSubmit,
}: CitizenReportDialogProps) {
  const [values, setValues] = useState<CitizenReportValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<CitizenReportErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const location = useDeviceLocation();

  useEffect(() => {
    if (!open) {
      return;
    }
    setValues(EMPTY_FORM);
    setErrors({});
    setSubmitting(false);
    setSubmitError(null);
    setGeoMessage(null);
  }, [open]);

  const useMapCenter = () => {
    setValues((current) => ({
      ...current,
      lat: String(mapCenter.lat),
      lng: String(mapCenter.lng),
    }));
    setGeoMessage(null);
  };

  const useDevicePosition = () => {
    const position = location.position;
    if (position) {
      setValues((current) => ({
        ...current,
        lat: String(position.lat),
        lng: String(position.lng),
      }));
      setGeoMessage(null);
      return;
    }
    setGeoMessage(
      location.status === 'unsupported'
        ? INSECURE_CONTEXT_MESSAGE
        : 'No pudimos obtener tu ubicación del dispositivo. Usa el centro del mapa o escríbela a mano.',
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateCitizenReport(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const input = buildCitizenReportInput(values);
    if (!input) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(input);
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'No se pudo enviar el reporte. Inténtalo de nuevo.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="citizen-report-desc">
        <DialogHeader>
          <DialogTitle>Reportar zona afectada</DialogTitle>
          <DialogDescription id="citizen-report-desc">
            Cuéntanos qué está pasando y dónde. El reporte aparecerá en el mapa para los centros de
            ayuda cercanos.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="citizen-report-level" className="nv-label text-muted-foreground">
              Nivel
            </label>
            <select
              id="citizen-report-level"
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
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="citizen-report-description" className="nv-label text-muted-foreground">
              Descripción
            </label>
            <textarea
              id="citizen-report-description"
              name="descripcion"
              rows={3}
              maxLength={MAX_DESCRIPCION}
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

          <div className="flex flex-col gap-2">
            <span className="nv-label text-muted-foreground">Ubicación</span>
            <p className="text-muted-foreground text-[11px]">
              Elige el punto desde el centro del mapa, tu dispositivo o escríbelo a mano.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={useMapCenter}>
                Usar el centro del mapa
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={useDevicePosition}>
                Usar mi ubicación
              </Button>
            </div>
            {geoMessage && (
              <p role="status" className="text-muted-foreground text-[11px]">
                {geoMessage}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="citizen-report-lat" className="nv-label text-muted-foreground">
                  Latitud
                </label>
                <input
                  id="citizen-report-lat"
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
                <label htmlFor="citizen-report-lng" className="nv-label text-muted-foreground">
                  Longitud
                </label>
                <input
                  id="citizen-report-lng"
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
          </div>

          {submitError && (
            <p role="alert" className="text-critical text-[11px]">
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Enviando…' : 'Reportar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
