import { afterEach, describe, expect, it } from 'vitest';
import type { SolicitudAmbulancia } from '@/types/domain';
import { useSolicitudesStore } from './solicitudes-store';

function solicitud(id: string): SolicitudAmbulancia {
  return {
    id,
    emergenciaId: `EMG-${id}`,
    estado: 'PENDING',
    centroAyudaId: 'CA-CRUE',
    zonaId: 'Suba',
    tipo: 'Solicitud de ambulancia',
    solicitadaEn: new Date(0).toISOString(),
    timeoutEn: new Date(45_000).toISOString(),
    ambulanciasNotificadas: ['A-07'],
    notifiedCount: 1,
    ambulanciaAsignadaId: null,
  };
}

describe('useSolicitudesStore', () => {
  afterEach(() => {
    useSolicitudesStore.getState().hydrate([]);
  });

  it('upserts a new request at the front and merges an existing one in place', () => {
    const store = useSolicitudesStore.getState();
    store.upsert(solicitud('REQ-1'));
    store.upsert(solicitud('REQ-2'));

    expect(useSolicitudesStore.getState().items.map((item) => item.id)).toEqual(['REQ-2', 'REQ-1']);

    useSolicitudesStore.getState().upsert({ ...solicitud('REQ-1'), zonaId: 'Kennedy' });

    const merged = useSolicitudesStore.getState().items.find((item) => item.id === 'REQ-1');
    expect(merged?.zonaId).toBe('Kennedy');
    expect(useSolicitudesStore.getState().items).toHaveLength(2);
  });

  it('removes a withdrawn request and leaves the others untouched', () => {
    const store = useSolicitudesStore.getState();
    store.upsert(solicitud('REQ-1'));
    store.upsert(solicitud('REQ-2'));

    useSolicitudesStore.getState().remove('REQ-1');

    expect(useSolicitudesStore.getState().items.map((item) => item.id)).toEqual(['REQ-2']);
  });

  it('ignores a removal for an unknown request', () => {
    useSolicitudesStore.getState().upsert(solicitud('REQ-1'));

    useSolicitudesStore.getState().remove('REQ-UNKNOWN');

    expect(useSolicitudesStore.getState().items.map((item) => item.id)).toEqual(['REQ-1']);
  });

  it('records the arrival once and closes the request as CONFIRMED', () => {
    useSolicitudesStore.getState().upsert(solicitud('REQ-1'));

    useSolicitudesStore.getState().markArrived('REQ-1');
    const arrived = useSolicitudesStore.getState().items.find((item) => item.id === 'REQ-1');
    expect(arrived?.llegadaEn).toBeDefined();

    // Idempotent: a repeated arrival must not move the recorded instant.
    useSolicitudesStore.getState().markArrived('REQ-1');
    expect(
      useSolicitudesStore.getState().items.find((item) => item.id === 'REQ-1')?.llegadaEn,
    ).toBe(arrived?.llegadaEn);

    useSolicitudesStore.getState().markConfirmed('REQ-1');
    expect(useSolicitudesStore.getState().items.find((item) => item.id === 'REQ-1')?.estado).toBe(
      'CONFIRMED',
    );
  });
});
