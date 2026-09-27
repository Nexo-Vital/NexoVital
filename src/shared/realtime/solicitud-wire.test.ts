import { describe, expect, it } from 'vitest';
import { fromWireSolicitud, solicitudFrameFromWire } from './solicitud-wire';

/**
 * Validates a wire object and asserts it passed. Keeps the call sites free of
 * non-null assertions while still failing loudly if the validator regresses.
 */
function validWire(value: unknown) {
  const frame = fromWireSolicitud(value);
  if (!frame) {
    throw new Error('expected a valid wire frame');
  }
  return frame;
}

/** The exact JSON shape `FlotaPushListener.SolicitudPushPayload` serializes. */
const PENDIENTE = {
  solicitudId: '11111111-1111-1111-1111-111111111111',
  emergenciaId: '22222222-2222-2222-2222-222222222222',
  zonaId: 'Suba',
  estado: 'PENDIENTE',
  ambulanciasNotificadas: ['33333333-3333-3333-3333-333333333333'],
  ambulanciaAsignadaId: null,
};

const CONTEXT = {
  // A DIFFERENT unit from the notified one, so the "no winner on the wire" case
  // proves the frame falls back to the receiving unit ('own') and not to a
  // notified id that happens to be present.
  ownAmbulanceId: 'own',
  escena: { lat: 4.742, lng: -74.09 },
  tipo: 'Traffic collision',
  nivel: 'HIGH' as const,
};

describe('fromWireSolicitud', () => {
  it('validates the backend frame and maps it to the wire shape', () => {
    expect(fromWireSolicitud(PENDIENTE)).toEqual({
      solicitudId: PENDIENTE.solicitudId,
      emergenciaId: PENDIENTE.emergenciaId,
      zonaId: 'Suba',
      estado: 'PENDIENTE',
      ambulanciasNotificadas: ['33333333-3333-3333-3333-333333333333'],
      ambulanciaAsignadaId: null,
    });
  });

  it('accepts a string winner and an absent winner', () => {
    expect(
      fromWireSolicitud({ ...PENDIENTE, estado: 'ASIGNADA', ambulanciaAsignadaId: 'winner' })
        ?.ambulanciaAsignadaId,
    ).toBe('winner');
    const withoutWinner = { ...PENDIENTE } as Record<string, unknown>;
    delete withoutWinner.ambulanciaAsignadaId;
    expect(fromWireSolicitud(withoutWinner)?.ambulanciaAsignadaId).toBeNull();
  });

  it('returns null on every malformed shape (never a blind cast)', () => {
    expect(fromWireSolicitud(null)).toBeNull();
    expect(fromWireSolicitud('nope')).toBeNull();
    expect(fromWireSolicitud({})).toBeNull();
    expect(fromWireSolicitud({ ...PENDIENTE, solicitudId: 7 })).toBeNull();
    expect(fromWireSolicitud({ ...PENDIENTE, emergenciaId: '' })).toBeNull();
    expect(fromWireSolicitud({ ...PENDIENTE, zonaId: 5 })).toBeNull();
    expect(fromWireSolicitud({ ...PENDIENTE, estado: 'DESCONOCIDO' })).toBeNull();
    expect(fromWireSolicitud({ ...PENDIENTE, ambulanciasNotificadas: 'A-1' })).toBeNull();
    expect(fromWireSolicitud({ ...PENDIENTE, ambulanciasNotificadas: [1] })).toBeNull();
    expect(fromWireSolicitud({ ...PENDIENTE, ambulanciaAsignadaId: 7 })).toBeNull();
    // A non-boolean arrival flag is malformed, never coerced.
    expect(fromWireSolicitud({ ...PENDIENTE, llegada: 'yes' })).toBeNull();
  });

  it('carries the arrival flag when it is true', () => {
    expect(fromWireSolicitud({ ...PENDIENTE, llegada: true })?.llegada).toBe(true);
    expect(fromWireSolicitud(PENDIENTE)?.llegada).toBeUndefined();
  });
});

describe('solicitudFrameFromWire', () => {
  it('maps PENDIENTE to an open broadcast, resolving the scene when known', () => {
    const frame = solicitudFrameFromWire(validWire(PENDIENTE), CONTEXT);
    expect(frame).toMatchObject({
      type: 'solicitud.broadcast',
      requestId: PENDIENTE.solicitudId,
      emergenciaId: PENDIENTE.emergenciaId,
      zonaId: 'Suba',
      tipo: 'Traffic collision',
      nivel: 'HIGH',
      escena: { lat: 4.742, lng: -74.09 },
      notificadas: ['33333333-3333-3333-3333-333333333333'],
      mode: 'broadcast',
      notifiedCount: 1,
    });
  });

  it('omits the scene/type it does not know instead of inventing them', () => {
    const frame = solicitudFrameFromWire(validWire(PENDIENTE), {
      ownAmbulanceId: 'own',
    });
    expect(frame).toMatchObject({ type: 'solicitud.broadcast', tipo: '' });
    expect(frame).not.toHaveProperty('escena');
    expect(frame).not.toHaveProperty('nivel');
  });

  it('maps ASIGNADA to request.taken with the wire winner (or this unit)', () => {
    const assigned = validWire({
      ...PENDIENTE,
      estado: 'ASIGNADA',
      ambulanciaAsignadaId: 'winner-9',
    });
    expect(solicitudFrameFromWire(assigned, CONTEXT)).toEqual({
      type: 'request.taken',
      requestId: PENDIENTE.solicitudId,
      winner: 'winner-9',
    });

    const withoutWinner = validWire({ ...PENDIENTE, estado: 'ASIGNADA' });
    expect(solicitudFrameFromWire(withoutWinner, CONTEXT)).toMatchObject({ winner: 'own' });
  });

  it('maps CONFIRMADA and RECHAZADA to their union frames', () => {
    const confirmed = validWire({ ...PENDIENTE, estado: 'CONFIRMADA' });
    expect(solicitudFrameFromWire(confirmed, CONTEXT)).toEqual({
      type: 'request.confirmed',
      requestId: PENDIENTE.solicitudId,
    });

    const rejected = validWire({ ...PENDIENTE, estado: 'RECHAZADA' });
    expect(solicitudFrameFromWire(rejected, CONTEXT)).toEqual({
      type: 'request.rejected',
      requestId: PENDIENTE.solicitudId,
      rejected: 'own',
      reason: 'rejected',
    });
  });

  it('returns null for lifecycle states the driver copy cannot act on', () => {
    const taken = validWire({ ...PENDIENTE, estado: 'TOMADA' });
    const timeout = validWire({ ...PENDIENTE, estado: 'TIMEOUT' });
    expect(solicitudFrameFromWire(taken, CONTEXT)).toBeNull();
    expect(solicitudFrameFromWire(timeout, CONTEXT)).toBeNull();
  });

  it('maps an arrival-flagged frame to request.arrived, keeping the estado out of it', () => {
    const arrived = validWire({
      ...PENDIENTE,
      estado: 'ASIGNADA',
      ambulanciaAsignadaId: 'winner-9',
      llegada: true,
    });
    expect(solicitudFrameFromWire(arrived, CONTEXT)).toEqual({
      type: 'request.arrived',
      requestId: PENDIENTE.solicitudId,
      ambulanceId: 'winner-9',
    });

    // No winner on the wire: the receiving unit is the arrival's author.
    const sinGanador = validWire({ ...PENDIENTE, estado: 'ASIGNADA', llegada: true });
    expect(solicitudFrameFromWire(sinGanador, CONTEXT)).toMatchObject({
      type: 'request.arrived',
      ambulanceId: 'own',
    });
  });
});
