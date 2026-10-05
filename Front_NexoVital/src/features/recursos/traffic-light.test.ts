import { describe, expect, it } from 'vitest';
import type { CentroAyuda, TrafficLight } from '@/types/domain';
import { centroSemaforo, trafficLight } from './traffic-light';

/** Builds a minimal aid center carrying one item per supplied semaphore. */
function centroWith(semaforos: TrafficLight[]): CentroAyuda {
  return {
    id: 'CA-TEST',
    nombre: 'Test center',
    ubicacion: { lat: 0, lng: 0 },
    items: semaforos.map((semaforo, index) => ({
      id: `INV-${index}`,
      centroAcopioId: 'CA-TEST',
      nombre: `Item ${index}`,
      disponible: 0,
      requerido: 0,
      semaforo,
      grammaticalNumber: 'singular',
    })),
  };
}

describe('trafficLight', () => {
  it('returns COMPLETE when no requirement was declared', () => {
    expect(trafficLight(50, 0)).toBe('COMPLETE');
    expect(trafficLight(0, 0)).toBe('COMPLETE');
  });

  it('returns RED below 35% of the requirement', () => {
    expect(trafficLight(0, 100)).toBe('RED');
    expect(trafficLight(34, 100)).toBe('RED');
  });

  it('returns AMBER from 35% (inclusive) to below 70%', () => {
    expect(trafficLight(35, 100)).toBe('AMBER');
    expect(trafficLight(50, 100)).toBe('AMBER');
    expect(trafficLight(69, 100)).toBe('AMBER');
  });

  it('returns GREEN from 70% (inclusive) to below 100%', () => {
    expect(trafficLight(70, 100)).toBe('GREEN');
    expect(trafficLight(99, 100)).toBe('GREEN');
  });

  it('returns COMPLETE at 100% or more', () => {
    expect(trafficLight(100, 100)).toBe('COMPLETE');
    expect(trafficLight(200, 100)).toBe('COMPLETE');
  });
});

describe('centroSemaforo', () => {
  it('is neutral for an empty inventory', () => {
    expect(centroSemaforo(centroWith([]))).toBe('NOT_DECLARED');
  });

  it('stays neutral when every item is NOT_DECLARED', () => {
    expect(centroSemaforo(centroWith(['NOT_DECLARED', 'NOT_DECLARED']))).toBe('NOT_DECLARED');
  });

  it('returns the worst level across the inventory', () => {
    expect(centroSemaforo(centroWith(['GREEN', 'GREEN']))).toBe('GREEN');
    expect(centroSemaforo(centroWith(['GREEN', 'AMBER', 'GREEN']))).toBe('AMBER');
    expect(centroSemaforo(centroWith(['GREEN', 'AMBER', 'RED']))).toBe('RED');
    expect(centroSemaforo(centroWith(['COMPLETE', 'GREEN']))).toBe('GREEN');
    expect(centroSemaforo(centroWith(['COMPLETE', 'COMPLETE']))).toBe('COMPLETE');
  });

  it('ignores NOT_DECLARED items when a real level exists', () => {
    expect(centroSemaforo(centroWith(['NOT_DECLARED', 'GREEN']))).toBe('GREEN');
    expect(centroSemaforo(centroWith(['RED', 'NOT_DECLARED']))).toBe('RED');
  });

  it('is independent of item order', () => {
    expect(centroSemaforo(centroWith(['AMBER', 'RED', 'GREEN']))).toBe(
      centroSemaforo(centroWith(['GREEN', 'RED', 'AMBER'])),
    );
  });
});
