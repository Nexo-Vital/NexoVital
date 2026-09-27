import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Web Audio double. jsdom has no audio graph, so the module is exercised against
 * a fake context: `resume()` flips the state to `running` (what a real user
 * gesture does) and every created oscillator is recorded.
 */
class FakeOscillator {
  type = 'sine';
  frequency = { setValueAtTime: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  onended: (() => void) | null = null;
}

class FakeGain {
  gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  oscillators: FakeOscillator[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  createOscillator = (): FakeOscillator => {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  };
  createGain = (): FakeGain => new FakeGain();
}

/** The single fake instance the module created, read back through the ctor spy. */
let created: FakeAudioContext | null = null;

function installFakeAudio(): void {
  created = null;
  class TrackingContext extends FakeAudioContext {
    constructor() {
      super();
      created = this;
    }
  }
  (globalThis as unknown as { AudioContext?: unknown }).AudioContext = TrackingContext;
}

function removeAudio(): void {
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  delete (globalThis as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
}

/**
 * The module keeps unlock state at module scope, so each case imports it fresh.
 */
async function loadModule() {
  vi.resetModules();
  return import('./request-sound');
}

describe('request-sound', () => {
  beforeEach(() => {
    removeAudio();
  });

  afterEach(() => {
    removeAudio();
  });

  it('reports unsupported and never plays when the environment has no Web Audio', async () => {
    const sound = await loadModule();

    expect(sound.isSoundSupported()).toBe(false);
    await expect(sound.unlockSound()).resolves.toBe(false);
    expect(sound.isSoundUnlocked()).toBe(false);
    expect(sound.playRequestDing()).toBe(false);
  });

  it('stays locked (and silent) until unlockSound runs from a user gesture', async () => {
    installFakeAudio();
    const sound = await loadModule();

    expect(sound.isSoundSupported()).toBe(true);
    expect(sound.isSoundUnlocked()).toBe(false);
    // Locked: it must NOT pretend it rang, and it must not even build the graph.
    expect(sound.playRequestDing()).toBe(false);
    expect(created).toBeNull();
  });

  it('unlocks on gesture and plays the two-tone ding', async () => {
    installFakeAudio();
    const sound = await loadModule();

    await expect(sound.unlockSound()).resolves.toBe(true);
    expect(sound.isSoundUnlocked()).toBe(true);

    expect(sound.playRequestDing()).toBe(true);
    // Two tones: A5 then D6, the rising "ding".
    expect(created?.oscillators).toHaveLength(2);
    expect(created?.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(880, 0);
    expect(created?.oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(
      1174.66,
      expect.any(Number),
    );
  });

  it('notifies subscribers when the unlock state changes', async () => {
    installFakeAudio();
    const sound = await loadModule();
    const listener = vi.fn();
    const unsubscribe = sound.subscribeSoundStatus(listener);

    await sound.unlockSound();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await sound.unlockSound();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
