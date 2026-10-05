import type { EmergencyLevel, EmergencyStatus, RequestState, TrafficLight } from '@/types/domain';

interface ColorMeta {
  label: string;
  dotClass: string;
  textClass: string;
  borderClass: string;
}

/** Registry colors. PENDING is the published broadcast, still awaiting accept. */
export const REQUEST_STATE_META: Record<RequestState, ColorMeta> = {
  PENDING: {
    label: 'Pending',
    dotClass: 'bg-event nv-pulse',
    textClass: 'text-event',
    borderClass: 'border-event/40',
  },
  ASSIGNED: {
    label: 'Assigned',
    dotClass: 'bg-assign',
    textClass: 'text-assign',
    borderClass: 'border-assign/40',
  },
  CONFIRMED: {
    label: 'Confirmed',
    dotClass: 'bg-assign',
    textClass: 'text-assign',
    borderClass: 'border-assign/40',
  },
  TAKEN: {
    label: 'Taken',
    dotClass: 'bg-ok',
    textClass: 'text-ok',
    borderClass: 'border-ok/40',
  },
  REJECTED: {
    label: 'Rejected',
    dotClass: 'bg-idle',
    textClass: 'text-idle',
    borderClass: 'border-idle/40',
  },
  TIMEOUT: {
    label: 'Timeout',
    dotClass: 'bg-critical',
    textClass: 'text-critical',
    borderClass: 'border-critical/40',
  },
  CANCELLED: {
    label: 'Cancelled',
    dotClass: 'bg-idle',
    textClass: 'text-idle',
    borderClass: 'border-idle/40',
  },
};

/**
 * Spanish lifecycle labels for the driver UI. The CRUE keeps the English
 * `REQUEST_STATE_META` above; this is the same vocabulary in the driver's
 * language ("Pendiente", "Tomada", ...), declared once and shared by the
 * request list and the request sheet.
 */
export const REQUEST_STATE_LABEL_ES: Record<RequestState, string> = {
  PENDING: 'Pendiente',
  ASSIGNED: 'Asignada',
  CONFIRMED: 'Confirmada',
  TAKEN: 'Tomada',
  REJECTED: 'Rechazada',
  TIMEOUT: 'Expirada',
  CANCELLED: 'Cancelada',
};

export const EMERGENCY_LEVEL_META: Record<EmergencyLevel, ColorMeta> = {
  LOW: { label: 'Low', dotClass: 'bg-ok', textClass: 'text-ok', borderClass: 'border-ok/40' },
  MEDIUM: {
    label: 'Medium',
    dotClass: 'bg-warning',
    textClass: 'text-warning',
    borderClass: 'border-warning/40',
  },
  HIGH: {
    label: 'High',
    dotClass: 'bg-assign',
    textClass: 'text-assign',
    borderClass: 'border-assign/40',
  },
  CRITICAL: {
    label: 'Critical',
    dotClass: 'bg-critical',
    textClass: 'text-critical',
    borderClass: 'border-critical/40',
  },
};

export const EMERGENCY_STATUS_LABEL: Record<EmergencyStatus, string> = {
  REPORTED: 'Reported',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const TRAFFIC_LIGHT_META: Record<TrafficLight, ColorMeta> = {
  RED: {
    label: 'Red',
    dotClass: 'bg-critical',
    textClass: 'text-critical',
    borderClass: 'border-critical/40',
  },
  AMBER: {
    label: 'Amber',
    dotClass: 'bg-warning',
    textClass: 'text-warning',
    borderClass: 'border-warning/40',
  },
  GREEN: {
    label: 'Green',
    dotClass: 'bg-ok',
    textClass: 'text-ok',
    borderClass: 'border-ok/40',
  },
  COMPLETE: {
    label: 'Complete',
    dotClass: 'bg-nv-complete',
    textClass: 'text-nv-complete',
    borderClass: 'border-nv-complete/40',
  },
  NOT_DECLARED: {
    label: 'Not declared',
    dotClass: 'bg-idle',
    textClass: 'text-idle',
    borderClass: 'border-idle/40',
  },
};
