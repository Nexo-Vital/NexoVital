import { describe, expect, it } from 'vitest';
import { type ArbiterRequests, resolveArbiterMessages } from './dev-arbiter';
import {
  DESTINATIONS,
  type SolicitudBroadcastPayload,
  type SolicitudDirectPayload,
} from './messages';

function envelope(destination: string, payload: unknown): string {
  return JSON.stringify({ destination, payload });
}

function broadcast(requestId: string): string {
  const payload: SolicitudBroadcastPayload = {
    type: 'solicitud.broadcast',
    requestId,
    emergenciaId: 'EMG-002',
    zonaId: 'Kennedy',
    tipo: 'Traffic collision',
    nivel: 'HIGH',
    escena: { lat: 4.628, lng: -74.148 },
    timeoutEn: new Date(Date.now() + 45_000).toISOString(),
    notificadas: ['AMB-01', 'AMB-03'],
  };
  return envelope(DESTINATIONS.solicitudes, payload);
}

function direct(requestId: string, targetAmbulanceId: string): string {
  const payload: SolicitudDirectPayload = {
    type: 'solicitud.direct',
    requestId,
    emergenciaId: 'EMG-002',
    zonaId: 'Kennedy',
    tipo: 'Traffic collision',
    nivel: 'HIGH',
    escena: { lat: 4.628, lng: -74.148 },
    timeoutEn: new Date(Date.now() + 45_000).toISOString(),
    notificadas: [targetAmbulanceId],
    mode: 'direct',
    targetAmbulanceId,
    notifiedCount: 1,
    timeoutMs: 45_000,
  };
  return envelope(DESTINATIONS.solicitudes, payload);
}

function accept(requestId: string, ambulanceId: string): string {
  return envelope(DESTINATIONS.solicitudes, {
    type: 'solicitud.accept',
    requestId,
    ambulanceId,
  });
}

function reject(requestId: string, ambulanceId: string): string {
  return envelope(DESTINATIONS.solicitudes, {
    type: 'solicitud.reject',
    requestId,
    ambulanceId,
  });
}

function parseSingle(messages: string[]): {
  type: string;
  winner?: string;
  rejected?: string;
  reason?: string;
} {
  expect(messages).toHaveLength(1);
  return JSON.parse(messages[0]).payload as {
    type: string;
    winner?: string;
    rejected?: string;
    reason?: string;
  };
}

describe('resolveArbiterMessages', () => {
  it('passes through messages that are not solicitud accepts', () => {
    const winners = new Map<string, string>();
    const raw = broadcast('REQ-1');
    expect(resolveArbiterMessages(raw, winners)).toEqual([raw]);
    expect(winners.size).toBe(0);
  });

  it('passes through invalid JSON unchanged', () => {
    const winners = new Map<string, string>();
    expect(resolveArbiterMessages('not-json', winners)).toEqual(['not-json']);
  });

  it('gives the request to the first accept and rejects later ones', () => {
    const winners = new Map<string, string>();
    resolveArbiterMessages(broadcast('REQ-1'), winners);

    const first = parseSingle(resolveArbiterMessages(accept('REQ-1', 'AMB-01'), winners));
    expect(first).toMatchObject({ type: 'request.taken', winner: 'AMB-01' });

    const second = parseSingle(resolveArbiterMessages(accept('REQ-1', 'AMB-09'), winners));
    expect(second).toMatchObject({
      type: 'request.already-taken',
      winner: 'AMB-01',
      rejected: 'AMB-09',
    });
  });

  it('re-opens the request when it is broadcast again', () => {
    const winners = new Map<string, string>();
    resolveArbiterMessages(broadcast('REQ-1'), winners);
    resolveArbiterMessages(accept('REQ-1', 'AMB-01'), winners);

    resolveArbiterMessages(broadcast('REQ-1'), winners);
    const next = parseSingle(resolveArbiterMessages(accept('REQ-1', 'AMB-09'), winners));
    expect(next).toMatchObject({ type: 'request.taken', winner: 'AMB-09' });
  });

  it('neither creates nor announces a winner on broadcast alone', () => {
    const winners = new Map<string, string>();
    const messages = resolveArbiterMessages(broadcast('REQ-1'), winners);
    expect(messages.join(' ')).not.toContain('request.taken');
    expect(winners.size).toBe(0);
  });

  describe('direct mode', () => {
    function directSetup(): { winners: Map<string, string>; requests: ArbiterRequests } {
      return { winners: new Map<string, string>(), requests: new Map() };
    }

    it('lets only the targeted unit accept', () => {
      const { winners, requests } = directSetup();
      resolveArbiterMessages(direct('REQ-D1', 'AMB-03'), winners, requests);

      const rejected = parseSingle(
        resolveArbiterMessages(accept('REQ-D1', 'AMB-07'), winners, requests),
      );
      expect(rejected).toMatchObject({
        type: 'request.rejected',
        rejected: 'AMB-07',
        reason: 'not-targeted',
      });
      expect(winners.size).toBe(0);

      const taken = parseSingle(
        resolveArbiterMessages(accept('REQ-D1', 'AMB-03'), winners, requests),
      );
      expect(taken).toMatchObject({ type: 'request.taken', winner: 'AMB-03' });
    });

    it('rejects a second accept after the target already won', () => {
      const { winners, requests } = directSetup();
      resolveArbiterMessages(direct('REQ-D1', 'AMB-03'), winners, requests);
      resolveArbiterMessages(accept('REQ-D1', 'AMB-03'), winners, requests);

      const late = parseSingle(
        resolveArbiterMessages(accept('REQ-D1', 'AMB-03'), winners, requests),
      );
      expect(late).toMatchObject({
        type: 'request.already-taken',
        winner: 'AMB-03',
        rejected: 'AMB-03',
      });
    });

    it('reopens the request when the target rejects it', () => {
      const { winners, requests } = directSetup();
      resolveArbiterMessages(direct('REQ-D1', 'AMB-03'), winners, requests);
      resolveArbiterMessages(reject('REQ-D1', 'AMB-03'), winners, requests);

      expect(winners.has('REQ-D1')).toBe(false);
      expect(requests.get('REQ-D1')?.open).toBe(true);

      const taken = parseSingle(
        resolveArbiterMessages(accept('REQ-D1', 'AMB-03'), winners, requests),
      );
      expect(taken).toMatchObject({ type: 'request.taken', winner: 'AMB-03' });
    });

    it('re-opens a direct request when it is sent again', () => {
      const { winners, requests } = directSetup();
      resolveArbiterMessages(direct('REQ-D1', 'AMB-03'), winners, requests);
      resolveArbiterMessages(accept('REQ-D1', 'AMB-03'), winners, requests);

      resolveArbiterMessages(direct('REQ-D1', 'AMB-03'), winners, requests);
      const taken = parseSingle(
        resolveArbiterMessages(accept('REQ-D1', 'AMB-03'), winners, requests),
      );
      expect(taken).toMatchObject({ type: 'request.taken', winner: 'AMB-03' });
    });
  });
});
