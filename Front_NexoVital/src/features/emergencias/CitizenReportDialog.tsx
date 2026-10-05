import { type FormEvent, useEffect, useRef, useState } from 'react';
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
  EMERGENCY_TYPE_LABELS,
  EMERGENCY_TYPE_OPTIONS,
} from '@/features/emergencias/emergency-type';
import {
  type DireccionSugerida,
  formatCoordenadas,
  MIN_ADDRESS_QUERY,
  reverseGeocode,
  searchAddress,
} from '@/features/geocodificacion/geocoding-api';
import {
  type DeviceLocationState,
  INSECURE_CONTEXT_MESSAGE,
} from '@/features/geolocalizacion/use-device-location';
import type { EmergencyLevel, EmergencyType, Ubicacion } from '@/types/domain';

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
  tipo: '',
  nivel: 'MEDIUM',
  descripcion: '',
  lat: '',
  lng: '',
};

/** How the citizen is telling us where the emergency is. */
type LocationMode = 'gps' | 'address';

/** Type-ahead state of the address search. */
type SearchStatus = 'idle' | 'loading' | 'empty' | 'error';

/**
 * Pause after the last keystroke before searching. The geocoder is a shared
 * public service: one request per pause, not one per letter.
 */
export const ADDRESS_SEARCH_DEBOUNCE_MS = 350;

const LOCATION_REQUIRED_MESSAGE =
  'Indica dónde está la emergencia: usa tu ubicación actual o elige una dirección.';

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface CitizenReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The point the citizen has on screen. It only BIASES the address search
   * towards that side of the city; it is never sent as the report's location.
   */
  mapCenter: Ubicacion;
  /**
   * Device GPS owned by the always-mounted page. The dialog never opens its own
   * watcher: a second high-accuracy watch would run for the whole session.
   */
  location: DeviceLocationState;
  /** Publishes the report (POST with backend, local publish in demo mode). */
  onSubmit: (input: ReportarEmergenciaInput) => Promise<void>;
}

/**
 * Citizen "report an affected zone" dialog (EP-02.F1.US3). The citizen picks the
 * emergency TYPE from a closed select, then its level, and writes a free comment
 * below.
 *
 * The location has two sources, and neither asks for coordinates: "Mi ubicación
 * actual" (the device GPS, shown back as its approximate address) and "Escribir
 * dirección" (a search with suggestions). The coordinates are what gets sent;
 * the address is only how a person reads them, so a geocoder failure never
 * blocks the report: the GPS path falls back to showing the coordinates. GPS is
 * a shortcut, never a gate: without a fix the dialog moves to the address path.
 */
export function CitizenReportDialog({
  open,
  onOpenChange,
  mapCenter,
  location,
  onSubmit,
}: CitizenReportDialogProps) {
  const [values, setValues] = useState<CitizenReportValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<CitizenReportErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<LocationMode | null>(null);
  /** Readable text of the chosen point; `null` while none is chosen. */
  const [chosenLabel, setChosenLabel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<DireccionSugerida[]>([]);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  /** The text a picked suggestion wrote into the input; it must not re-search. */
  const pickedQuery = useRef<string | null>(null);
  /** Invalidates a reverse lookup the citizen has already moved on from. */
  const reverseToken = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    setValues(EMPTY_FORM);
    setErrors({});
    setSubmitting(false);
    setSubmitError(null);
    setGeoMessage(null);
    setMode(null);
    setChosenLabel(null);
    setQuery('');
    setSuggestions([]);
    setSearchStatus('idle');
    pickedQuery.current = null;
    reverseToken.current += 1;
  }, [open]);

  // Debounced address search. A newer keystroke aborts the request in flight, so
  // a slow answer to "Calle 1" can never overwrite the list for "Calle 100".
  const biasLat = mapCenter.lat;
  const biasLng = mapCenter.lng;
  useEffect(() => {
    if (!open || mode !== 'address') {
      return;
    }
    const text = query.trim();
    if (text.length < MIN_ADDRESS_QUERY || text === pickedQuery.current) {
      setSuggestions([]);
      setSearchStatus('idle');
      return;
    }
    const controller = new AbortController();
    setSearchStatus('loading');
    const timeoutId = setTimeout(() => {
      searchAddress(text, { cerca: { lat: biasLat, lng: biasLng }, signal: controller.signal })
        .then((found) => {
          if (controller.signal.aborted) {
            return;
          }
          setSuggestions(found);
          setSearchStatus(found.length > 0 ? 'idle' : 'empty');
        })
        .catch(() => {
          if (controller.signal.aborted) {
            return;
          }
          setSuggestions([]);
          setSearchStatus('error');
        });
    }, ADDRESS_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [open, mode, query, biasLat, biasLng]);

  const setPoint = (point: Ubicacion | null) => {
    setValues((current) => ({
      ...current,
      lat: point ? String(point.lat) : '',
      lng: point ? String(point.lng) : '',
    }));
    if (point) {
      setErrors((current) => ({ ...current, lat: undefined, lng: undefined }));
    }
  };

  const useDevicePosition = () => {
    const position = location.position;
    reverseToken.current += 1;
    if (!position) {
      // No fix: the address path is the way forward, so open it right away.
      setMode('address');
      setPoint(null);
      setChosenLabel(null);
      setGeoMessage(
        location.status === 'unsupported'
          ? INSECURE_CONTEXT_MESSAGE
          : 'No pudimos obtener tu ubicación del dispositivo. Escribe la dirección.',
      );
      return;
    }
    const token = reverseToken.current;
    setMode('gps');
    setGeoMessage(null);
    setPoint(position);
    setChosenLabel('Buscando la dirección…');
    reverseGeocode(position)
      .then((address) => {
        if (reverseToken.current !== token) {
          return;
        }
        setChosenLabel(address ? `Cerca de ${address}` : formatCoordenadas(position));
      })
      .catch(() => {
        if (reverseToken.current === token) {
          setChosenLabel(formatCoordenadas(position));
        }
      });
  };

  const useAddress = () => {
    if (mode === 'address') {
      return;
    }
    reverseToken.current += 1;
    setMode('address');
    setGeoMessage(null);
    setPoint(null);
    setChosenLabel(null);
  };

  const handleQueryChange = (text: string) => {
    setQuery(text);
    // Editing the text invalidates the point picked for the previous text.
    if (pickedQuery.current !== null && text !== pickedQuery.current) {
      pickedQuery.current = null;
      setPoint(null);
      setChosenLabel(null);
    }
  };

  const pickSuggestion = (suggestion: DireccionSugerida) => {
    pickedQuery.current = suggestion.etiqueta;
    setQuery(suggestion.etiqueta);
    setSuggestions([]);
    setSearchStatus('idle');
    setPoint(suggestion.ubicacion);
    setChosenLabel(suggestion.etiqueta);
  };

  const locationError = errors.lat || errors.lng ? LOCATION_REQUIRED_MESSAGE : null;

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
            <label htmlFor="citizen-report-type" className="nv-label text-muted-foreground">
              Tipo de emergencia
            </label>
            <select
              id="citizen-report-type"
              name="tipo"
              value={values.tipo}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  tipo: event.target.value as EmergencyType | '',
                }))
              }
              aria-invalid={Boolean(errors.tipo)}
              className={FIELD_CLASS}
            >
              {/* Placeholder: the citizen must choose; no type is sent by default. */}
              <option value="" disabled>
                Selecciona el tipo
              </option>
              {EMERGENCY_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {EMERGENCY_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            {errors.tipo && (
              <p role="alert" className="text-critical text-[11px]">
                {errors.tipo}
              </p>
            )}
          </div>

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
              Comentario
            </label>
            <textarea
              id="citizen-report-description"
              name="descripcion"
              rows={3}
              maxLength={MAX_DESCRIPCION}
              placeholder="Cuéntanos qué está pasando"
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
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === 'gps' ? 'default' : 'outline'}
                aria-pressed={mode === 'gps'}
                onClick={useDevicePosition}
              >
                Mi ubicación actual
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'address' ? 'default' : 'outline'}
                aria-pressed={mode === 'address'}
                onClick={useAddress}
              >
                Escribir dirección
              </Button>
            </div>
            {geoMessage && (
              <p role="status" className="text-muted-foreground text-[11px]">
                {geoMessage}
              </p>
            )}

            {mode === 'address' && (
              <div className="flex flex-col gap-1">
                <label htmlFor="citizen-report-address" className="nv-label text-muted-foreground">
                  Dirección
                </label>
                <input
                  id="citizen-report-address"
                  name="direccion"
                  type="search"
                  autoComplete="off"
                  placeholder="Ej.: Carrera 7 con calle 45, Bogotá"
                  value={query}
                  onChange={(event) => handleQueryChange(event.target.value)}
                  aria-invalid={Boolean(locationError)}
                  className={FIELD_CLASS}
                />
                {searchStatus === 'loading' && (
                  <p role="status" className="text-muted-foreground text-[11px]">
                    Buscando direcciones…
                  </p>
                )}
                {searchStatus === 'empty' && (
                  <p role="status" className="text-muted-foreground text-[11px]">
                    No encontramos esa dirección. Prueba con la calle o el barrio.
                  </p>
                )}
                {searchStatus === 'error' && (
                  <p role="status" className="text-muted-foreground text-[11px]">
                    El buscador de direcciones no responde. Inténtalo de nuevo o usa tu ubicación
                    actual.
                  </p>
                )}
                {suggestions.length > 0 && (
                  <ul
                    aria-label="Direcciones sugeridas"
                    className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-input"
                  >
                    {suggestions.map((suggestion) => (
                      <li key={suggestion.etiqueta}>
                        <button
                          type="button"
                          onClick={() => pickSuggestion(suggestion)}
                          className="w-full px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                        >
                          {suggestion.etiqueta}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {chosenLabel && (
              <p className="rounded-md bg-muted px-2 py-1.5 text-sm">
                <span className="nv-label text-muted-foreground">Ubicación elegida: </span>
                <span data-testid="citizen-report-chosen-location">{chosenLabel}</span>
              </p>
            )}
            {mode === 'gps' && chosenLabel && (
              <p className="text-muted-foreground text-[11px]">
                La dirección es aproximada; el punto exacto es el de tu dispositivo.
              </p>
            )}
            {locationError && (
              <p role="alert" className="text-critical text-[11px]">
                {locationError}
              </p>
            )}
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
