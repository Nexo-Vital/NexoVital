/**
 * Synthesized "new request" ding, no audio file and no dependency.
 *
 * Two short sine tones (a rising two-note chime, the Rappi/Uber feel) built with
 * the Web Audio API.
 *
 * The sound is ON by default: the driver does not have to switch it on. What
 * the page cannot decide is the browser's own rule: audio stays blocked until a
 * USER GESTURE. `enableSoundOnFirstGesture()` therefore unlocks it with the
 * first click or key press anywhere on the page (connecting is one), and the
 * module keeps tracking whether it is unlocked, so the UI can say "the browser
 * is still blocking the sound" instead of pretending it rang.
 *
 * The driver can still silence it (`setSoundMuted`); that choice is remembered
 * in this browser.
 */

type SoundListener = () => void;

/** Where the driver's "silenced" choice is remembered, in this browser only. */
const MUTED_STORAGE_KEY = 'nexovital.conductor.sonido-silenciado';

/** A browser without storage (or with it blocked) just starts with sound on. */
function readMutedPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let audioContext: AudioContext | null = null;
let unlocked = false;
let muted = readMutedPreference();
const listeners = new Set<SoundListener>();

/** First two tones of the chime: A5 then D6, ~0.15s each. */
const DING_TONES = [
  { frequency: 880.0, offset: 0, duration: 0.16 },
  { frequency: 1174.66, offset: 0.15, duration: 0.2 },
] as const;
const PEAK_GAIN = 0.32;

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const scope = globalThis as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/** Whether this environment can synthesize audio at all. */
export function isSoundSupported(): boolean {
  return getAudioContextConstructor() !== null;
}

/** Whether a user gesture already unlocked playback for this page session. */
export function isSoundUnlocked(): boolean {
  return unlocked;
}

/** Whether the driver silenced the request sound. Off by default. */
export function isSoundMuted(): boolean {
  return muted;
}

/**
 * Silences or restores the request sound. The choice is remembered in this
 * browser; when it cannot be stored it still holds for this page session.
 */
export function setSoundMuted(next: boolean): void {
  muted = next;
  try {
    if (next) {
      globalThis.localStorage?.setItem(MUTED_STORAGE_KEY, '1');
    } else {
      globalThis.localStorage?.removeItem(MUTED_STORAGE_KEY);
    }
  } catch {
    // Not stored: the choice lasts until the page is reloaded.
  }
  notify();
}

/** Subscribe to unlock and mute changes; stable, so it is safe for React. */
export function subscribeSoundStatus(listener: SoundListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function getAudioContext(): AudioContext | null {
  if (audioContext) {
    return audioContext;
  }
  const Context = getAudioContextConstructor();
  if (!Context) {
    return null;
  }
  audioContext = new Context();
  return audioContext;
}

/**
 * Resumes the audio context from a user gesture. Must be called inside a click
 * handler, or the browser keeps the context suspended. Returns whether playback
 * is now unlocked; never throws.
 */
export async function unlockSound(): Promise<boolean> {
  const context = getAudioContext();
  if (!context) {
    unlocked = false;
    notify();
    return false;
  }
  try {
    if (context.state === 'suspended') {
      await context.resume();
    }
    unlocked = context.state === 'running';
  } catch {
    unlocked = false;
  }
  notify();
  return unlocked;
}

/**
 * Unlocks the sound with the first click, touch or key press on the page, so
 * the driver never has to look for a "turn the sound on" control. The browser
 * only accepts the unlock from inside a gesture, and that is exactly where this
 * runs. Returns the cleanup; it is safe to call more than once.
 */
export function enableSoundOnFirstGesture(): () => void {
  if (typeof window === 'undefined' || !isSoundSupported() || unlocked) {
    return () => undefined;
  }
  const events = ['pointerdown', 'keydown'] as const;
  const stop = () => {
    for (const event of events) {
      window.removeEventListener(event, onGesture, true);
    }
  };
  const onGesture = () => {
    void unlockSound().then((ok) => {
      if (ok) {
        stop();
      }
    });
  };
  for (const event of events) {
    window.addEventListener(event, onGesture, true);
  }
  return stop;
}

/** One enveloped tone at `start` seconds; disconnects itself when done. */
function playTone(context: AudioContext, start: number, frequency: number, duration: number): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  // Short attack and exponential decay: a clean "ding", not a click.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

/**
 * Plays the two-tone ding and returns whether it actually played. Returns
 * `false` (without touching the audio graph) when the driver silenced it, the
 * environment has no Web Audio or the context was never unlocked by a user
 * gesture.
 */
export function playRequestDing(): boolean {
  const context = audioContext;
  if (muted || !context || !unlocked || context.state !== 'running') {
    return false;
  }
  const now = context.currentTime;
  for (const tone of DING_TONES) {
    playTone(context, now + tone.offset, tone.frequency, tone.duration);
  }
  return true;
}
