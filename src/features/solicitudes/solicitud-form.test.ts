import { describe, expect, it } from 'vitest';
import { MOCK_AMBULANCIAS, MOCK_EMERGENCIAS } from '@/mocks/fixtures';
import {
  activeEmergencies,
  buildSolicitudRequest,
  nextRequestId,
  toSolicitud,
  validateRequestForm,
} from './solicitud-form';

const EMERGENCY = MOCK_EMERGENCIAS[0]; // EMG-001, CRITICAL, IN_PROGRESS
const TARGET = MOCK_AMBULANCIAS.find((unit) => unit.id === 'AMB-03');
if (!TARGET) {
  throw new Error('AMB-03 fixture is required');
}

describe('activeEmergencies', () => {
  it('excludes resolved and closed emergencies', () => {
    const ids = activeEmergencies(MOCK_EMERGENCIAS).map((item) => item.id);

    expect(ids).not.toContain('EMG-005'); // RESOLVED
    expect(ids).toContain('EMG-001');
  });
});

describe('buildSolicitudRequest', () => {
  it('broadcast/all notifies every available unit and never sets a winner', () => {
    const payload = buildSolicitudRequest({
      emergencia: EMERGENCY,
      mode: 'broadcast',
      scope: 'all',
      zone: null,
      target: null,
      units: MOCK_AMBULANCIAS,
      requestId: 'REQ-1',
      now: 1_000,
    });

    const available = MOCK_AMBULANCIAS.filter((unit) => unit.estado === 'AVAILABLE');
    expect(payload).toMatchObject({
      type: 'solicitud.broadcast',
      mode: 'broadcast',
      requestId: 'REQ-1',
      zonaId: EMERGENCY.zonaId,
      notifiedCount: available.length,
    });
    expect(payload.notificadas).toEqual(available.map((unit) => unit.id));
    expect(payload).not.toHaveProperty('targetAmbulanceId');
    expect(payload).not.toHaveProperty('winner');
  });

  it('broadcast/zone only notifies available units in the chosen zone', () => {
    const payload = buildSolicitudRequest({
      emergencia: EMERGENCY,
      mode: 'broadcast',
      scope: 'zone',
      zone: 'Centro',
      target: null,
      units: MOCK_AMBULANCIAS,
      requestId: 'REQ-2',
    });

    // AMB-02 is Centro but EN_ROUTE; AMB-10 is the only available Centro unit.
    expect(payload.notificadas).toEqual(['AMB-10']);
    expect(payload.zonaId).toBe('Centro');
  });

  it('direct notifies exactly the target', () => {
    const payload = buildSolicitudRequest({
      emergencia: EMERGENCY,
      mode: 'direct',
      scope: 'all',
      zone: null,
      target: TARGET,
      units: MOCK_AMBULANCIAS,
      requestId: 'REQ-3',
    });

    expect(payload).toMatchObject({
      type: 'solicitud.direct',
      mode: 'direct',
      targetAmbulanceId: 'AMB-03',
      notifiedCount: 1,
    });
    expect(payload.notificadas).toEqual(['AMB-03']);
  });
});

describe('validateRequestForm', () => {
  it('requires an active emergency', () => {
    const errors = validateRequestForm(
      { emergenciaId: '', mode: 'broadcast', scope: 'all', zone: '', targetAmbulanceId: '' },
      MOCK_EMERGENCIAS,
      MOCK_AMBULANCIAS,
    );

    expect(errors.emergenciaId).toBeDefined();
  });

  it('requires a zone and matching units when scoping by zone', () => {
    const errors = validateRequestForm(
      {
        emergenciaId: EMERGENCY.id,
        mode: 'broadcast',
        scope: 'zone',
        zone: 'Usaquén',
        targetAmbulanceId: '',
      },
      MOCK_EMERGENCIAS,
      MOCK_AMBULANCIAS,
    );

    expect(errors.zone).toBeUndefined();
    expect(errors.units).toBeUndefined();

    const empty = validateRequestForm(
      {
        emergenciaId: EMERGENCY.id,
        mode: 'broadcast',
        scope: 'zone',
        zone: '',
        targetAmbulanceId: '',
      },
      MOCK_EMERGENCIAS,
      MOCK_AMBULANCIAS,
    );
    expect(empty.zone).toBeDefined();
  });

  it('requires an available target in direct mode', () => {
    const errors = validateRequestForm(
      {
        emergenciaId: EMERGENCY.id,
        mode: 'direct',
        scope: 'all',
        zone: '',
        targetAmbulanceId: 'AMB-04',
      },
      MOCK_EMERGENCIAS,
      MOCK_AMBULANCIAS,
    );

    expect(errors.targetAmbulanceId).toBeDefined();
  });
});

describe('nextRequestId', () => {
  it('returns unique REQ ids', () => {
    const first = nextRequestId();
    const second = nextRequestId();

    expect(first).toMatch(/^REQ-/);
    expect(first).not.toBe(second);
  });
});

describe('toSolicitud', () => {
  it('maps a published request to a PENDING registry row', () => {
    const payload = buildSolicitudRequest({
      emergencia: EMERGENCY,
      mode: 'broadcast',
      scope: 'all',
      zone: null,
      target: null,
      units: MOCK_AMBULANCIAS,
      requestId: 'REQ-9',
      now: 5_000,
    });

    const solicitud = toSolicitud(payload, 5_000);

    expect(solicitud).toMatchObject({
      id: 'REQ-9',
      emergenciaId: EMERGENCY.id,
      estado: 'PENDING',
      ambulanciasNotificadas: payload.notificadas,
      ambulanciaAsignadaId: null,
    });
  });
});
