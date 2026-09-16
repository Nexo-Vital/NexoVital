import type { AmbulanceState } from '@/types/domain';

interface AmbulanceStateMeta {
  label: string;
  dotClass: string;
  textClass: string;
}

/** Domain colors for fleet states (blue = en route, orange = assigned). */
export const AMBULANCE_STATE_META: Record<AmbulanceState, AmbulanceStateMeta> = {
  AVAILABLE: { label: 'Available', dotClass: 'bg-ok', textClass: 'text-ok' },
  ASSIGNED: { label: 'Assigned', dotClass: 'bg-assign', textClass: 'text-assign' },
  EN_ROUTE: { label: 'En route', dotClass: 'bg-event', textClass: 'text-event' },
  MAINTENANCE: { label: 'Maintenance', dotClass: 'bg-idle', textClass: 'text-idle' },
};
