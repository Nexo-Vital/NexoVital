import type { AmbulanceState } from '@/types/domain';

export type DriverStatus = 'AVAILABLE' | 'EN_ROUTE' | 'ON_SCENE' | 'OFF_DUTY';

export interface DriverStatusMeta {
  label: string;
  dotClass: string;
  textClass: string;
  /** Fleet state published on /topic/flota for this driver status. */
  estado: AmbulanceState;
}

export const DRIVER_STATUS_ORDER: DriverStatus[] = [
  'AVAILABLE',
  'EN_ROUTE',
  'ON_SCENE',
  'OFF_DUTY',
];

export const DRIVER_STATUS_META: Record<DriverStatus, DriverStatusMeta> = {
  AVAILABLE: { label: 'Available', dotClass: 'bg-ok', textClass: 'text-ok', estado: 'AVAILABLE' },
  EN_ROUTE: {
    label: 'En route',
    dotClass: 'bg-event',
    textClass: 'text-event',
    estado: 'EN_ROUTE',
  },
  ON_SCENE: {
    label: 'On scene',
    dotClass: 'bg-assign',
    textClass: 'text-assign',
    estado: 'ASSIGNED',
  },
  OFF_DUTY: {
    label: 'Off duty',
    dotClass: 'bg-idle',
    textClass: 'text-idle',
    estado: 'MAINTENANCE',
  },
};
