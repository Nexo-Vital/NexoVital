/**
 * Synthesized "new request" ding, no audio file and no dependency.
 *
 * Two short sine tones (a rising two-note chime, the Rappi/Uber feel) built with
 * the Web Audio API. Browsers block audio until a USER GESTURE, so this module
 * tracks whether it was unlocked: the driver UI offers a discreet control that
 * calls `unlockSound()` from a click, and `playRequestDing()` refuses to play
 * (and reports `false`) while locked. Nothing here ever pretends it rang.
 */

type SoundListener = () => void;

let audioContext: AudioContext | null = null;
let unlocked = false;
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

/** Subscribe to unlock-state changes; stable, so it is safe for React. */
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
 * `false` (without touching the audio graph) when the environment has no Web
 * Audio or the context was never unlocked by a user gesture.
 */
export function playRequestDing(): boolean {
  const context = audioContext;
  if (!context || !unlocked || context.state !== 'running') {
    return false;
  }
  const now = context.currentTime;
  for (const tone of DING_TONES) {
    playTone(context, now + tone.offset, tone.frequency, tone.duration);
  }
  return true;
}
