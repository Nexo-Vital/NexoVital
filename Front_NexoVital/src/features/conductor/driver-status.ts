import { CITIZEN_UNIT_META } from '@/features/ciudadano/citizen-view';
import type { AmbulanceState } from '@/types/domain';

export type DriverStatus = 'AVAILABLE' | 'EN_ROUTE' | 'ON_SCENE' | 'OFF_DUTY';

export interface DriverStatusMeta {
  label: string;
  dotClass: string;
  textClass: string;
  /**
   * Driver-facing chip palette, read from the shared citizen unit meta so the
   * lime/navy buckets cannot drift from the map legend and the citizen rail.
   */
  chipClass: string;
  /** Fleet state published on /topic/flota for this driver status. */
  estado: AmbulanceState;
}

export const DRIVER_STATUS_ORDER: DriverStatus[] = [
  'AVAILABLE',
  'EN_ROUTE',
  'ON_SCENE',
  'OFF_DUTY',
];

/**
 * Neutral chip for a driver who is off duty. It is the shared `--nv-idle` token
 * (the same neutral the rail already uses for "not declared"), NOT the vehicle
 * "maintenance" bucket: a driver out of service is not a unit under repair.
 */
const OFF_DUTY_CHIP_CLASS = 'bg-idle/15 text-idle ring-1 ring-idle/40';

/**
 * The driver's own vocabulary. These are DRIVER states, not vehicle states: the
 * fleet `estado` is what gets published on /topic/flota, but the rail must name
 * what the person declared. "Fuera de servicio" never reads "En mantenimiento".
 */
export const DRIVER_STATUS_META: Record<DriverStatus, DriverStatusMeta> = {
  AVAILABLE: {
    label: 'Disponible',
    dotClass: 'bg-ok',
    textClass: 'text-ok',
    chipClass: CITIZEN_UNIT_META.free.chipClass,
    estado: 'AVAILABLE',
  },
  EN_ROUTE: {
    label: 'En ruta',
    dotClass: 'bg-event',
    textClass: 'text-event',
    chipClass: CITIZEN_UNIT_META.busy.chipClass,
    estado: 'EN_ROUTE',
  },
  ON_SCENE: {
    label: 'En escena',
    dotClass: 'bg-assign',
    textClass: 'text-assign',
    chipClass: CITIZEN_UNIT_META.busy.chipClass,
    estado: 'ASSIGNED',
  },
  OFF_DUTY: {
    label: 'Fuera de servicio',
    dotClass: 'bg-idle',
    textClass: 'text-idle',
    chipClass: OFF_DUTY_CHIP_CLASS,
    estado: 'MAINTENANCE',
  },
};
