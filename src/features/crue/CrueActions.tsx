import { RadioTower, Siren } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmergencyFormDialog } from '@/features/emergencias/EmergencyFormDialog';
import { NewRequestDialog } from '@/features/solicitudes/NewRequestDialog';
import type { SolicitudRequestPayload } from '@/features/solicitudes/solicitud-form';
import { cn } from '@/lib/utils';
import type { Ambulancia, Emergencia, RolUsuario, Ubicacion } from '@/types/domain';

/**
 * Contract role gate. Emergencies are reported by ADMIN_PLATAFORMA (aid-center
 * admins are allowed for the demo); requests are created by ADMIN_CENTRO_AYUDA
 * (platform admins are the demo super-admin). Controls are never hidden: when a
 * role is not allowed the button is disabled and the reason is spelled out.
 */
const EMERGENCY_ROLES: RolUsuario[] = ['ADMIN_PLATAFORMA', 'ADMIN_CENTRO_AYUDA'];
const REQUEST_ROLES: RolUsuario[] = ['ADMIN_CENTRO_AYUDA', 'ADMIN_PLATAFORMA'];

const EMERGENCY_REASON = 'Only platform or aid-center admins can report emergencies.';
const REQUEST_REASON = 'Only aid-center or platform admins can create requests.';

interface CrueActionsProps {
  emergencies: Emergencia[];
  fleet: Ambulancia[];
  mapCenter: Ubicacion;
  userRole: RolUsuario | null;
  onCreateEmergency: (emergency: Emergencia) => void;
  onCreateRequest: (payload: SolicitudRequestPayload) => void;
  className?: string;
}

/** Map-overlay action bar: report an emergency or compose a request. */
export function CrueActions({
  emergencies,
  fleet,
  mapCenter,
  userRole,
  onCreateEmergency,
  onCreateRequest,
  className,
}: CrueActionsProps) {
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  const canReportEmergency = userRole !== null && EMERGENCY_ROLES.includes(userRole);
  const canCreateRequest = userRole !== null && REQUEST_ROLES.includes(userRole);

  return (
    <>
      <div
        data-testid="crue-actions"
        className={cn(
          'pointer-events-auto flex flex-col gap-1 rounded-md border border-border bg-card/95 p-1.5 backdrop-blur',
          className,
        )}
      >
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canReportEmergency}
            title={canReportEmergency ? 'Report a new emergency' : EMERGENCY_REASON}
            onClick={() => setEmergencyOpen(true)}
          >
            <Siren className="size-3.5" />
            Report emergency
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canCreateRequest}
            title={canCreateRequest ? 'Create a new request' : REQUEST_REASON}
            onClick={() => setRequestOpen(true)}
          >
            <RadioTower className="size-3.5" />
            New request
          </Button>
        </div>
        {!canReportEmergency && (
          <p className="max-w-[16rem] text-[10px] text-muted-foreground">{EMERGENCY_REASON}</p>
        )}
        {!canCreateRequest && (
          <p className="max-w-[16rem] text-[10px] text-muted-foreground">{REQUEST_REASON}</p>
        )}
      </div>

      <EmergencyFormDialog
        open={emergencyOpen}
        onOpenChange={setEmergencyOpen}
        emergencies={emergencies}
        mapCenter={mapCenter}
        onCreate={onCreateEmergency}
      />
      <NewRequestDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        emergencies={emergencies}
        fleet={fleet}
        onCreate={onCreateRequest}
      />
    </>
  );
}
