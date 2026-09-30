import { describe, expect, it } from 'vitest';
import type { SolicitudAmbulancia } from '@/types/domain';
import { canRespondToSolicitud, solicitudResponseBlockReason } from './solicitud-response';

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
