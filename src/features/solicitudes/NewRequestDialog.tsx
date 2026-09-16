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
import { EMERGENCY_LEVEL_META } from '@/features/solicitudes/request-status';
import {
  activeEmergencies,
  availableUnits,
  type BroadcastScope,
  buildSolicitudRequest,
  nextRequestId,
  type RequestFormErrors,
  type RequestFormValues,
  type SolicitudRequestPayload,
  unitsForScope,
  validateRequestForm,
  zonesOf,
} from '@/features/solicitudes/solicitud-form';
import { cn } from '@/lib/utils';
import type { SolicitudMode } from '@/shared/realtime';
import type { Ambulancia, Emergencia } from '@/types/domain';

const FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface NewRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emergencies: Emergencia[];
  fleet: Ambulancia[];
  onCreate: (payload: SolicitudRequestPayload) => void;
}

/**
 * Request composer. Two unmistakable delivery modes:
 *   - Broadcast: N available units are offered the request; the arbiter decides
 *     the winner on first accept. This console never picks the winner.
 *   - Direct: exactly one unit is addressed; there is no race.
 */
export function NewRequestDialog({
  open,
  onOpenChange,
  emergencies,
  fleet,
  onCreate,
}: NewRequestDialogProps) {
  const [emergenciaId, setEmergenciaId] = useState('');
  const [mode, setMode] = useState<SolicitudMode>('broadcast');
  const [scope, setScope] = useState<BroadcastScope>('all');
  const [zone, setZone] = useState('');
  const [targetAmbulanceId, setTargetAmbulanceId] = useState('');
  const [errors, setErrors] = useState<RequestFormErrors>({});
  const [requestId, setRequestId] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }
    setEmergenciaId('');
    setMode('broadcast');
    setScope('all');
    setZone('');
    setTargetAmbulanceId('');
    setErrors({});
    setRequestId(nextRequestId());
  }, [open]);

  const active = activeEmergencies(emergencies);
  const available = availableUnits(fleet);
  const zones = zonesOf(available);
  const selectedEmergency = active.find((item) => item.id === emergenciaId) ?? null;
  const target = available.find((item) => item.id === targetAmbulanceId) ?? null;
  const previewUnits =
    mode === 'direct' ? (target ? [target] : []) : unitsForScope(fleet, scope, zone);
  const cannotSubmit = active.length === 0 || available.length === 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values: RequestFormValues = {
      emergenciaId,
      mode,
      scope,
      zone,
      targetAmbulanceId,
    };
    const nextErrors = validateRequestForm(values, emergencies, fleet);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !selectedEmergency) {
      return;
    }
    const payload = buildSolicitudRequest({
      emergencia: selectedEmergency,
      mode,
      scope,
      zone: scope === 'zone' ? zone : null,
      target,
      units: fleet,
      requestId,
    });
    onCreate(payload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="request-dialog-desc">
        <DialogHeader>
          <DialogTitle>New request</DialogTitle>
          <DialogDescription id="request-dialog-desc">
            Choose the emergency and how it is delivered. Published on /queue/solicitudes.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor="request-emergency" className="nv-label text-muted-foreground">
              Emergency
            </label>
            {active.length === 0 ? (
              <p className="rounded-md border border-border bg-surface-2 px-3 py-4 text-center text-muted-foreground text-xs">
                No active emergencies yet — report one to start.
              </p>
            ) : (
              <select
                id="request-emergency"
                name="emergenciaId"
                value={emergenciaId}
                onChange={(event) => setEmergenciaId(event.target.value)}
                aria-invalid={Boolean(errors.emergenciaId)}
                className={FIELD_CLASS}
              >
                <option value="">Select an emergency…</option>
                {active.map((emergency) => (
                  <option key={emergency.id} value={emergency.id}>
                    [{emergency.id}] {EMERGENCY_LEVEL_META[emergency.nivel].label} ·{' '}
                    {emergency.zonaId}
                  </option>
                ))}
              </select>
            )}
            {errors.emergenciaId && (
              <p role="alert" className="text-critical text-[11px]">
                {errors.emergenciaId}
              </p>
            )}
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="nv-label mb-1 text-muted-foreground">Target mode</legend>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="radio"
                name="request-mode"
                value="broadcast"
                checked={mode === 'broadcast'}
                onChange={() => setMode('broadcast')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Broadcast</span>
                <span className="block text-muted-foreground">
                  Offer to several units. The first accept wins, decided by the arbiter.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs">
              <input
                type="radio"
                name="request-mode"
                value="direct"
                checked={mode === 'direct'}
                onChange={() => setMode('direct')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Direct</span>
                <span className="block text-muted-foreground">
                  Address one unit. Only that unit is notified; there is no race.
                </span>
              </span>
            </label>
          </fieldset>

          {mode === 'broadcast' ? (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2/60 p-2">
              <fieldset className="flex flex-col gap-1.5">
                <legend className="nv-label mb-1 text-muted-foreground">Scope</legend>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="request-scope"
                    value="all"
                    checked={scope === 'all'}
                    onChange={() => setScope('all')}
                  />
                  All available units
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="request-scope"
                    value="zone"
                    checked={scope === 'zone'}
                    onChange={() => setScope('zone')}
                  />
                  By zone
                </label>
              </fieldset>

              {scope === 'zone' && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="request-zone" className="nv-label text-muted-foreground">
                    Zone
                  </label>
                  <select
                    id="request-zone"
                    name="zone"
                    value={zone}
                    onChange={(event) => setZone(event.target.value)}
                    aria-invalid={Boolean(errors.zone)}
                    className={FIELD_CLASS}
                  >
                    <option value="">Select a zone…</option>
                    {zones.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  {errors.zone && (
                    <p role="alert" className="text-critical text-[11px]">
                      {errors.zone}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-2/60 p-2">
              <label htmlFor="request-target" className="nv-label text-muted-foreground">
                Unit
              </label>
              {available.length === 0 ? (
                <p className="text-muted-foreground text-xs">No units available.</p>
              ) : (
                <select
                  id="request-target"
                  name="targetAmbulanceId"
                  value={targetAmbulanceId}
                  onChange={(event) => setTargetAmbulanceId(event.target.value)}
                  aria-invalid={Boolean(errors.targetAmbulanceId)}
                  className={FIELD_CLASS}
                >
                  <option value="">Select a unit…</option>
                  {available.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.id} · {unit.driverName}
                    </option>
                  ))}
                </select>
              )}
              {errors.targetAmbulanceId && (
                <p role="alert" className="text-critical text-[11px]">
                  {errors.targetAmbulanceId}
                </p>
              )}
            </div>
          )}

          <p
            role="status"
            className={cn(
              'rounded-md border px-2 py-1.5 text-[11px]',
              mode === 'direct' ? 'border-assign/40 bg-assign/10' : 'border-event/40 bg-event/10',
            )}
          >
            {mode === 'direct'
              ? target
                ? `Only ${target.id} will be notified.`
                : 'Select one unit to notify.'
              : `${previewUnits.length} units will be notified. The first to accept wins.`}
          </p>

          {errors.units && (
            <p role="alert" className="text-critical text-[11px]">
              {errors.units}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={cannotSubmit}>
              Create request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
