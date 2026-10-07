import { describe, expect, it } from 'vitest';
import type { SolicitudAmbulancia } from '@/types/domain';
import {
  canRespondToSolicitud,
  REJECTED_BY_UNIT_REASON,
  rejectedByUnit,
  solicitudResponseBlockReason,
} from './solicitud-response';

/**
 * The server's answer rule, mirrored by the driver UI: a request is respondible
 * while it is still PENDING and the driver's own unit appears in its notified
 * list. It is deliberately independent of delivery order — that is the whole
 * point of the task, since the front used to allow only the latest broadcast.
 */
const UNIT = 'AMB-01';

function solicitud(overrides: Partial<SolicitudAmbulancia> = {}): SolicitudAmbulancia {
  return {
    id: 'REQ-1',
    emergenciaId: 'EMG-1',
    estado: 'PENDING',
    centroAyudaId: '',
    zonaId: 'Kennedy',
    ubicacion: { lat: 4.6, lng: -74.1 },
    tipo: 'Traffic collision',
    solicitadaEn: '2026-01-01T00:00:00.000Z',
    timeoutEn: '2026-01-01T00:45:00.000Z',
    ambulanciasNotificadas: [UNIT, 'AMB-02'],
    notifiedCount: 2,
    ambulanciaAsignadaId: null,
    ...overrides,
  };
}

describe('canRespondToSolicitud', () => {
  it('enables a notified PENDING request regardless of arrival order', () => {
    expect(canRespondToSolicitud(solicitud(), UNIT)).toBe(true);
  });

  it('stays disabled when the unit was not notified', () => {
    expect(canRespondToSolicitud(solicitud({ ambulanciasNotificadas: ['AMB-02'] }), UNIT)).toBe(
      false,
    );
  });

  it('stays disabled when the unit id is unresolved (empty)', () => {
    expect(canRespondToSolicitud(solicitud(), '')).toBe(false);
  });

  it.each(['ASSIGNED', 'CONFIRMED', 'TAKEN', 'REJECTED', 'TIMEOUT', 'CANCELLED'] as const)(
    'stays disabled once the request is %s',
    (estado) => {
      expect(canRespondToSolicitud(solicitud({ estado }), UNIT)).toBe(false);
    },
  );
});

describe('solicitudResponseBlockReason', () => {
  it('is null for a respondible row', () => {
    expect(solicitudResponseBlockReason(solicitud(), UNIT)).toBeNull();
  });

  it('explains a non-notified row', () => {
    expect(
      solicitudResponseBlockReason(solicitud({ ambulanciasNotificadas: ['AMB-02'] }), UNIT),
    ).toMatch(/No fuiste avisado/);
  });

  it('explains a row that is no longer PENDING', () => {
    expect(solicitudResponseBlockReason(solicitud({ estado: 'TAKEN' }), UNIT)).toMatch(
      /ya no está pendiente/,
    );
  });
});

/**
 * EP-04.F2.US5: a decline is final for the unit that made it. The request stays
 * PENDING and listed, but that unit can no longer answer it, which is the same
 * thing the server enforces (409 `SOLICITUD_YA_RECHAZADA`).
 */
describe('a request this unit declined', () => {
  const declined = solicitud({ ambulanciasRechazaron: [UNIT] });

  it('is recognised by the unit that declined it and by nobody else', () => {
    expect(rejectedByUnit(declined, UNIT)).toBe(true);
    expect(rejectedByUnit(declined, 'AMB-02')).toBe(false);
    expect(rejectedByUnit(solicitud(), UNIT)).toBe(false);
    // An unresolved unit declined nothing.
    expect(rejectedByUnit(declined, '')).toBe(false);
  });

  it('can no longer be answered by that unit, although it is still PENDING', () => {
    expect(declined.estado).toBe('PENDING');
    expect(canRespondToSolicitud(declined, UNIT)).toBe(false);
    expect(solicitudResponseBlockReason(declined, UNIT)).toBe(REJECTED_BY_UNIT_REASON);
  });

  it('stays answerable for the other notified units', () => {
    expect(canRespondToSolicitud(declined, 'AMB-02')).toBe(true);
    expect(solicitudResponseBlockReason(declined, 'AMB-02')).toBeNull();
  });

  it('treats a row without the list as one nobody declined', () => {
    const { ambulanciasRechazaron: _omitted, ...withoutList } = declined;
    expect(canRespondToSolicitud(withoutList, UNIT)).toBe(true);
  });
});
