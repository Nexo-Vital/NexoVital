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

  it('records a decline once per unit and leaves the request PENDING (EP-04.F2.US5)', () => {
    const store = useSolicitudesStore.getState();
    store.upsert(solicitud('REQ-1'));
    store.upsert(solicitud('REQ-2'));

    useSolicitudesStore.getState().markRejected('REQ-1', 'A-07');
    useSolicitudesStore.getState().markRejected('REQ-1', 'A-07');

    const declined = useSolicitudesStore.getState().items.find((item) => item.id === 'REQ-1');
    expect(declined?.ambulanciasRechazaron).toEqual(['A-07']);
    // The row stays listed and open: only that unit can no longer answer it.
    expect(declined?.estado).toBe('PENDING');
    const other = useSolicitudesStore.getState().items.find((item) => item.id === 'REQ-2');
    expect(other?.ambulanciasRechazaron ?? []).toEqual([]);
  });

  it('keeps the decline when a later frame for the same request carries no list', () => {
    useSolicitudesStore.getState().upsert(solicitud('REQ-1'));
    useSolicitudesStore.getState().markRejected('REQ-1', 'A-07');

    useSolicitudesStore.getState().upsert({ ...solicitud('REQ-1'), zonaId: 'Kennedy' });

    const merged = useSolicitudesStore.getState().items.find((item) => item.id === 'REQ-1');
    expect(merged?.zonaId).toBe('Kennedy');
    expect(merged?.ambulanciasRechazaron).toEqual(['A-07']);
  });
});
