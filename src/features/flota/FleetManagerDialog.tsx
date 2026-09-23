import { Pencil, Plus, Trash2 } from 'lucide-react';
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
import { AMBULANCE_STATE_META } from '@/features/flota/ambulance-status';
import {
  buildAmbulance,
  type FleetFormErrors,
  type FleetFormValues,
  nextAmbulanceId,
  validateFleetForm,
} from '@/features/flota/fleet-form';
import { cn } from '@/lib/utils';
import type { AmbulanceState, Ambulancia, Ubicacion } from '@/types/domain';

const STATE_OPTIONS: AmbulanceState[] = ['AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'MAINTENANCE'];

const EMPTY_FORM: FleetFormValues = { driverName: '', estado: 'AVAILABLE', lat: '', lng: '' };

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface FleetManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: Ambulancia[];
  mapCenter: Ubicacion;
  onCreate: (unit: Ambulancia) => void;
  onUpdate: (id: string, patch: { driverName: string; estado: AmbulanceState }) => void;
  onDelete: (id: string) => void;
}

/**
 * Fleet CRUD surface. Create assigns an auto id (A-16, A-17, ...); edit
 * changes driver name and state; delete removes the unit. Position is a numeric
 * lat/lng pair or the current map center. The parent owns store + publish.
 */
export function FleetManagerDialog({
  open,
  onOpenChange,
  units,
  mapCenter,
  onCreate,
  onUpdate,
  onDelete,
}: FleetManagerDialogProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<FleetFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FleetFormErrors>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Reset transient state every time the dialog is opened so a reopened dialog
  // never shows stale input. Radix moves focus to the first control for us.
  useEffect(() => {
    if (!open) {
      return;
    }
    setFormOpen(false);
    setEditingId(null);
    setValues(EMPTY_FORM);
    setErrors({});
    setConfirmDeleteId(null);
  }, [open]);

  const startCreate = () => {
    setEditingId(null);
    setValues(EMPTY_FORM);
    setErrors({});
    setFormOpen(true);
  };

  const startEdit = (unit: Ambulancia) => {
    setEditingId(unit.id);
    setValues({ driverName: unit.driverName, estado: unit.estado, lat: '', lng: '' });
    setErrors({});
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setErrors({});
  };

  const useMapCenter = () => {
    setValues((current) => ({
      ...current,
      lat: String(mapCenter.lat),
      lng: String(mapCenter.lng),
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const editing = editingId !== null;
    const nextErrors = validateFleetForm(values, { requirePosition: !editing });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    if (editing) {
      onUpdate(editingId, { driverName: values.driverName.trim(), estado: values.estado });
      closeForm();
      onOpenChange(false);
      return;
    }
    const unit = buildAmbulance(values, nextAmbulanceId(units));
    if (!unit) {
      return;
    }
    onCreate(unit);
    closeForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="fleet-manager-desc">
        <DialogHeader>
          <DialogTitle>Manage fleet</DialogTitle>
          <DialogDescription id="fleet-manager-desc">
            Create, edit or remove ambulances. Every change is published on /topic/flota.
          </DialogDescription>
        </DialogHeader>

        {!formOpen ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="nv-label text-muted-foreground">Units</span>
              <Button type="button" size="sm" variant="outline" onClick={startCreate}>
                <Plus className="size-3.5" />
                New unit
              </Button>
            </div>

            {units.length === 0 ? (
              <p className="rounded-md border border-border bg-surface-2 px-3 py-6 text-center text-muted-foreground text-xs">
                No units available.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                <ul className="flex flex-col gap-1 pr-2">
                  {units.map((unit) => {
                    const meta = AMBULANCE_STATE_META[unit.estado];
                    const confirming = confirmDeleteId === unit.id;
                    return (
                      <li
                        key={unit.id}
                        className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1.5"
                      >
                        <span
                          className={cn('size-2 shrink-0 rounded-full', meta.dotClass)}
                          aria-hidden
                        />
                        <span className="tabular font-medium text-xs">{unit.id}</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                          {unit.driverName} · {meta.label}
                        </span>
                        {confirming ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                onDelete(unit.id);
                                setConfirmDeleteId(null);
                                onOpenChange(false);
                              }}
                            >
                              Confirm
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Edit ${unit.id}`}
                              onClick={() => startEdit(unit)}
                              className="size-7"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Delete ${unit.id}`}
                              onClick={() => setConfirmDeleteId(unit.id)}
                              className="size-7"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
            {editingId && (
              <p className="text-muted-foreground text-xs">
                Editing <span className="tabular font-medium text-foreground">{editingId}</span>
              </p>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="fleet-driver-name" className="nv-label text-muted-foreground">
                Driver name
              </label>
              <input
                id="fleet-driver-name"
                name="driverName"
                value={values.driverName}
                onChange={(event) =>
                  setValues((current) => ({ ...current, driverName: event.target.value }))
                }
                aria-invalid={Boolean(errors.driverName)}
                className={FIELD_CLASS}
              />
              {errors.driverName && (
                <p role="alert" className="text-critical text-[11px]">
                  {errors.driverName}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="fleet-state" className="nv-label text-muted-foreground">
                State
              </label>
              <select
                id="fleet-state"
                name="estado"
                value={values.estado}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    estado: event.target.value as AmbulanceState,
                  }))
                }
                className={FIELD_CLASS}
              >
                {STATE_OPTIONS.map((state) => (
                  <option key={state} value={state}>
                    {AMBULANCE_STATE_META[state].label}
                  </option>
                ))}
              </select>
            </div>

            {!editingId && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="fleet-lat" className="nv-label text-muted-foreground">
                      Latitude
                    </label>
                    <input
                      id="fleet-lat"
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
                    <label htmlFor="fleet-lng" className="nv-label text-muted-foreground">
                      Longitude
                    </label>
                    <input
                      id="fleet-lng"
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
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit">{editingId ? 'Save changes' : 'Create unit'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
