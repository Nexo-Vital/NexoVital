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
  ubicacion: { lat: 4.73, lng: -74.08 },
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
      ubicacion: { lat: 4.73, lng: -74.08 },
      emergenciaId: PENDIENTE.emergenciaId,
      zonaId: 'Suba',
      estado: 'PENDIENTE',
      ambulanciasNotificadas: ['33333333-3333-3333-3333-333333333333'],
      ambulanciaAsignadaId: null,
    });
  });

  it('accepts null emergency/zone and a missing pickup point', () => {
    const suelta = fromWireSolicitud({
      ...PENDIENTE,
      ubicacion: null,
      emergenciaId: null,
      zonaId: null,
    });
    expect(suelta).toMatchObject({ emergenciaId: null, zonaId: null, ubicacion: null });
  });

  it('carries the address and the requester name into the offer', () => {
    const frame = fromWireSolicitud({
      ...PENDIENTE,
      direccion: 'Calle 145 # 91-19, Suba',
      solicitanteNombre: 'Ana Gómez',
    });
    expect(frame?.direccion).toBe('Calle 145 # 91-19, Suba');
    const offer = frame ? solicitudFrameFromWire(frame, CONTEXT) : null;
    expect(offer).toMatchObject({
      type: 'solicitud.broadcast',
      direccion: 'Calle 145 # 91-19, Suba',
      solicitanteNombre: 'Ana Gómez',
    });
  });

  it('keeps the two instants of a request that is offered late', () => {
    const solicitadaEn = '2026-10-07T07:00:00Z';
    const timeoutEn = '2026-10-07T07:01:00Z';
    expect(fromWireSolicitud({ ...PENDIENTE, solicitadaEn, timeoutEn })).toMatchObject({
      solicitadaEn,
      timeoutEn,
    });
    // An instant that cannot be read is left out, never passed through.
    const sinFechas = fromWireSolicitud({ ...PENDIENTE, solicitadaEn: 'ayer', timeoutEn: 7 });
    expect(sinFechas).not.toBeNull();
    expect(sinFechas).not.toHaveProperty('solicitadaEn');
    expect(sinFechas).not.toHaveProperty('timeoutEn');
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
    // A present-but-malformed pickup point is a malformed frame.
    expect(fromWireSolicitud({ ...PENDIENTE, ubicacion: 'nope' })).toBeNull();
    expect(fromWireSolicitud({ ...PENDIENTE, ubicacion: { lat: 'x', lng: 1 } })).toBeNull();
    // A non-boolean arrival flag is malformed, never coerced.
    expect(fromWireSolicitud({ ...PENDIENTE, llegada: 'yes' })).toBeNull();
  });

  it('carries the arrival flag when it is true', () => {
    expect(fromWireSolicitud({ ...PENDIENTE, llegada: true })?.llegada).toBe(true);
    expect(fromWireSolicitud(PENDIENTE)?.llegada).toBeUndefined();
  });
});

describe('solicitudFrameFromWire', () => {
  it('maps PENDIENTE to an open broadcast, using the frame pickup point', () => {
    const frame = solicitudFrameFromWire(validWire(PENDIENTE), CONTEXT);
    expect(frame).toMatchObject({
      type: 'solicitud.broadcast',
      requestId: PENDIENTE.solicitudId,
      emergenciaId: PENDIENTE.emergenciaId,
      zonaId: 'Suba',
      tipo: 'Traffic collision',
      nivel: 'HIGH',
      // The frame's own pickup point wins over the emergency-resolved context.
      escena: { lat: 4.73, lng: -74.08 },
      notificadas: ['33333333-3333-3333-3333-333333333333'],
      mode: 'broadcast',
      notifiedCount: 1,
    });
  });

  it('a creation frame declares no deadline; a late offer passes its own through', () => {
    expect(solicitudFrameFromWire(validWire(PENDIENTE), CONTEXT)).toMatchObject({ timeoutEn: '' });
    expect(solicitudFrameFromWire(validWire(PENDIENTE), CONTEXT)).not.toHaveProperty('timeoutMs');

    const tardia = solicitudFrameFromWire(
      validWire({
        ...PENDIENTE,
        solicitadaEn: '2026-10-07T07:00:00Z',
        timeoutEn: '2026-10-07T07:01:00Z',
      }),
      CONTEXT,
    );
    // The deadline is the request's own, and the window is its real length.
    expect(tardia).toMatchObject({ timeoutEn: '2026-10-07T07:01:00Z', timeoutMs: 60_000 });
  });

  it('falls back to the context scene only when the frame carries no pickup point', () => {
    const frame = solicitudFrameFromWire(validWire({ ...PENDIENTE, ubicacion: null }), CONTEXT);
    expect(frame).toMatchObject({ escena: { lat: 4.742, lng: -74.09 } });
  });

  it('omits the scene/type it does not know instead of inventing them', () => {
    const frame = solicitudFrameFromWire(
      validWire({ ...PENDIENTE, ubicacion: null, emergenciaId: null, zonaId: null }),
      { ownAmbulanceId: 'own' },
    );
    expect(frame).toMatchObject({
      type: 'solicitud.broadcast',
      tipo: '',
      emergenciaId: '',
      zonaId: '',
    });
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

  it('maps TOMADA to request.closed and TIMEOUT to request.expired', () => {
    const taken = validWire({ ...PENDIENTE, estado: 'TOMADA' });
    const timeout = validWire({ ...PENDIENTE, estado: 'TIMEOUT' });
    expect(solicitudFrameFromWire(taken, CONTEXT)).toEqual({
      type: 'request.closed',
      requestId: PENDIENTE.solicitudId,
    });
    expect(solicitudFrameFromWire(timeout, CONTEXT)).toEqual({
      type: 'request.expired',
      requestId: PENDIENTE.solicitudId,
    });
  });

  it('maps CANCELADA to request.cancelled (the requester withdrew the open request)', () => {
    const cancelled = validWire({ ...PENDIENTE, estado: 'CANCELADA' });
    expect(solicitudFrameFromWire(cancelled, CONTEXT)).toEqual({
      type: 'request.cancelled',
      requestId: PENDIENTE.solicitudId,
    });
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
