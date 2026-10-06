import { Plus, Trash2 } from 'lucide-react';
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
import { LocationPicker } from '@/features/geocodificacion/LocationPicker';
import type { DeviceLocationState } from '@/features/geolocalizacion/use-device-location';
import type { Ubicacion } from '@/types/domain';
import type { CrearMiCentroInput } from './my-center-api';
import {
  buildCenterInput,
  type CenterFormErrors,
  emptyInsumoRow,
  hasErrors,
  type InsumoRow,
  MAX_INSUMOS_INICIALES,
  MAX_NOMBRE_CENTRO,
  MAX_NOMBRE_INSUMO,
  onlyDigits,
  validateCenterForm,
} from './my-center-form';

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface CreateCenterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Biases the address search towards what the administrator has on screen. */
  mapCenter: Ubicacion;
  /** Device GPS owned by the page; the dialog never opens its own watcher. */
  location: DeviceLocationState;
  /** Creates the center. A rejection keeps the dialog open and shows its message. */
  onSubmit: (input: CrearMiCentroInput) => Promise<void>;
}

/**
 * "Crear centro" form of the help-center administrator (EP-03.F1.US1): the
 * center's name, where it is, and the supplies it asks for — each with what the
 * center has today and the maximum it needs.
 *
 * The location uses the same two sources as the affected-zone report ("Mi
 * ubicación actual" or "Escribir dirección"). The supply list starts with one
 * empty row because a center is created to ask for something; more can be added
 * here or later from "Administrar mi centro".
 */
export function CreateCenterDialog({
  open,
  onOpenChange,
  mapCenter,
  location,
  onSubmit,
}: CreateCenterDialogProps) {
  const [nombre, setNombre] = useState('');
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null);
  const [insumos, setInsumos] = useState<InsumoRow[]>(() => [emptyInsumoRow()]);
  const [errors, setErrors] = useState<CenterFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Remounts the location picker so a reopened dialog starts with no choice. */
  const [pickerKey, setPickerKey] = useState(0);

  useEffect(() => {
    if (!open) {
      return;
    }
    setNombre('');
    setUbicacion(null);
    setInsumos([emptyInsumoRow()]);
    setErrors({});
    setSubmitting(false);
    setSubmitError(null);
    setPickerKey((current) => current + 1);
  }, [open]);

  // An error belongs to the value that caused it: editing a field drops ITS
  // message right away, so a corrected field never keeps a stale red line. The
  // next submit validates everything again.
  const clearRowErrors = (key: string) => {
    setErrors((current) => {
      if (!current.filas?.[key]) {
        return current;
      }
      const { [key]: _dropped, ...filas } = current.filas;
      return { ...current, filas };
    });
  };

  const handleNombreChange = (value: string) => {
    setNombre(value);
    setErrors((current) => (current.nombre ? { ...current, nombre: undefined } : current));
  };

  const handleUbicacionChange = (point: Ubicacion | null) => {
    setUbicacion(point);
    if (point) {
      setErrors((current) => (current.ubicacion ? { ...current, ubicacion: undefined } : current));
    }
  };

  const updateRow = (key: string, patch: Partial<InsumoRow>) => {
    setInsumos((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    clearRowErrors(key);
  };

  const removeRow = (key: string) => {
    setInsumos((current) => current.filter((row) => row.key !== key));
    clearRowErrors(key);
  };

  const addRow = () => {
    setInsumos((current) => [...current, emptyInsumoRow()]);
    setErrors((current) => (current.insumos ? { ...current, insumos: undefined } : current));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = { nombre, ubicacion, insumos };
    const nextErrors = validateCenterForm(values);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      return;
    }
    const input = buildCenterInput(values);
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
        error instanceof Error ? error.message : 'No se pudo crear el centro. Inténtalo de nuevo.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="create-center-desc"
        className="max-h-[92dvh] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>Crear centro</DialogTitle>
          <DialogDescription id="create-center-desc">
            Registra tu centro y los insumos que necesita. Aparecerá en el mapa con su semáforo para
            que las personas puedan donarle.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="create-center-name" className="nv-label text-muted-foreground">
              Nombre del centro
            </label>
            <input
              id="create-center-name"
              name="nombre"
              type="text"
              autoComplete="off"
              maxLength={MAX_NOMBRE_CENTRO}
              placeholder="Ej.: Centro de ayuda Suba Rincón"
              value={nombre}
              onChange={(event) => handleNombreChange(event.target.value)}
              aria-invalid={Boolean(errors.nombre)}
              className={FIELD_CLASS}
            />
            {errors.nombre && (
              <p role="alert" className="text-critical text-[11px]">
                {errors.nombre}
              </p>
            )}
          </div>

          <LocationPicker
            key={pickerKey}
            idPrefix="create-center"
            bias={mapCenter}
            location={location}
            onChange={handleUbicacionChange}
            error={errors.ubicacion ?? null}
          />

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="nv-label text-muted-foreground">
              Insumos que necesita el centro
            </legend>
            <p className="text-muted-foreground text-[11px]">
              Por cada insumo indica cuántas unidades tienes hoy y el máximo que necesita el centro.
            </p>

            <ul className="flex list-none flex-col gap-2 p-0">
              {insumos.map((row, index) => {
                const rowErrors = errors.filas?.[row.key];
                const position = index + 1;
                return (
                  <li
                    key={row.key}
                    className="flex flex-col gap-1.5 rounded-md border border-input p-2.5"
                  >
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_92px_92px_36px] sm:items-end">
                      <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
                        <label
                          htmlFor={`${row.key}-nombre`}
                          className="nv-label text-muted-foreground"
                        >
                          Insumo {position}
                        </label>
                        <input
                          id={`${row.key}-nombre`}
                          type="text"
                          autoComplete="off"
                          maxLength={MAX_NOMBRE_INSUMO}
                          placeholder="Ej.: Agua potable"
                          value={row.nombre}
                          onChange={(event) => updateRow(row.key, { nombre: event.target.value })}
                          aria-invalid={Boolean(rowErrors?.nombre)}
                          className={FIELD_CLASS}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={`${row.key}-disponible`}
                          className="nv-label text-muted-foreground"
                        >
                          Tengo hoy
                        </label>
                        <input
                          id={`${row.key}-disponible`}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="0"
                          aria-label={`Cantidad actual del insumo ${position}`}
                          value={row.disponible}
                          onChange={(event) =>
                            updateRow(row.key, { disponible: onlyDigits(event.target.value) })
                          }
                          aria-invalid={Boolean(rowErrors?.disponible)}
                          className={`${FIELD_CLASS} tabular`}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={`${row.key}-requerido`}
                          className="nv-label text-muted-foreground"
                        >
                          Máximo
                        </label>
                        <input
                          id={`${row.key}-requerido`}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="0"
                          aria-label={`Cantidad máxima del insumo ${position}`}
                          value={row.requerido}
                          onChange={(event) =>
                            updateRow(row.key, { requerido: onlyDigits(event.target.value) })
                          }
                          aria-invalid={Boolean(rowErrors?.requerido)}
                          className={`${FIELD_CLASS} tabular`}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Quitar el insumo ${position}`}
                        onClick={() => removeRow(row.key)}
                        disabled={insumos.length === 1}
                        className="col-span-2 justify-self-end sm:col-span-1"
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                    {rowErrors && (
                      <p role="alert" className="text-critical text-[11px]">
                        {[rowErrors.nombre, rowErrors.disponible, rowErrors.requerido]
                          .filter(Boolean)
                          .join(' ')}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {errors.insumos && (
              <p role="alert" className="text-critical text-[11px]">
                {errors.insumos}
              </p>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={insumos.length >= MAX_INSUMOS_INICIALES}
              className="self-start"
            >
              <Plus aria-hidden />
              Agregar otro insumo
            </Button>
          </fieldset>

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
              {submitting ? 'Creando…' : 'Crear centro'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
