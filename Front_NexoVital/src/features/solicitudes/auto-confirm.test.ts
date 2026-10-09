import { describe, expect, it } from 'vitest';
import { AUTO_CONFIRM_SECONDS, autoConfirmSecondsLeft, formatSecondsLeft } from './auto-confirm';

describe('auto-confirm countdown', () => {
  it('counts down from the arrival and stops at zero', () => {
    const arrivedAt = 1_000_000;
    expect(autoConfirmSecondsLeft(arrivedAt, arrivedAt)).toBe(AUTO_CONFIRM_SECONDS);
    expect(autoConfirmSecondsLeft(arrivedAt, arrivedAt + 15_500)).toBe(45);
    expect(autoConfirmSecondsLeft(arrivedAt, arrivedAt + 120_000)).toBe(0);
  });

  it('formats the remaining time as m:ss', () => {
    expect(formatSecondsLeft(60)).toBe('1:00');
    expect(formatSecondsLeft(9)).toBe('0:09');
  });
});
