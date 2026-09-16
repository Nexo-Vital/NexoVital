import { describe, expect, it } from 'vitest';
import { trafficLight } from './traffic-light';

describe('trafficLight', () => {
  it('returns NOT_DECLARED when no requirement was declared', () => {
    expect(trafficLight(50, 0)).toBe('NOT_DECLARED');
    expect(trafficLight(0, 0)).toBe('NOT_DECLARED');
  });

  it('returns RED below 30% of the requirement', () => {
    expect(trafficLight(0, 100)).toBe('RED');
    expect(trafficLight(29, 100)).toBe('RED');
  });

  it('returns AMBER between 30% and 80% inclusive', () => {
    expect(trafficLight(30, 100)).toBe('AMBER');
    expect(trafficLight(50, 100)).toBe('AMBER');
    expect(trafficLight(80, 100)).toBe('AMBER');
  });

  it('returns GREEN above 80% of the requirement', () => {
    expect(trafficLight(81, 100)).toBe('GREEN');
    expect(trafficLight(200, 100)).toBe('GREEN');
  });
});
