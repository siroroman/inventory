/**
 * What the scanner sounds and feels like for each kind of result, so a person who is pointing the
 * phone at a shelf knows what happened without looking at the sheet. The tones are made with Web
 * Audio (no sound files to load or cache); the contour carries the meaning: rising is good, level is
 * neutral, falling needs a look, and the count and rhythm tell the siblings apart.
 */

export type FeedbackKind =
  /** An item of the list was checked. */
  | 'found'
  /** An item that was flagged as missing turned up. */
  | 'recovered'
  /** An item was found away from where it is registered. */
  | 'elsewhere'
  /** Somebody had checked it already. */
  | 'already'
  /** The item is archived and does not count. */
  | 'archived'
  /** The text has the form of an ID, but no item has it. */
  | 'unknown'
  /** A QR code that is not ours. */
  | 'foreign'
  /** The scan was not saved. */
  | 'error';

/** One tone: all times in milliseconds from the start of the pattern, `gain` 0 to 1. */
export type Note = { freq: number; at: number; length: number; wave: OscillatorType; gain: number };

export type Pattern = { notes: readonly Note[]; vibrate: number | readonly number[] };

// Square waves are much louder than sines at the same gain, so they are set lower.
export const patterns: Record<FeedbackKind, Pattern> = {
  found: {
    notes: [{ freq: 880, at: 0, length: 90, wave: 'sine', gain: 0.3 }],
    vibrate: 40,
  },
  recovered: {
    notes: [
      { freq: 660, at: 0, length: 90, wave: 'sine', gain: 0.3 },
      { freq: 880, at: 110, length: 90, wave: 'sine', gain: 0.3 },
      { freq: 1175, at: 220, length: 160, wave: 'sine', gain: 0.3 },
    ],
    vibrate: [40, 50, 40, 50, 40],
  },
  elsewhere: {
    notes: [
      { freq: 740, at: 0, length: 110, wave: 'sine', gain: 0.3 },
      { freq: 520, at: 140, length: 170, wave: 'sine', gain: 0.3 },
    ],
    vibrate: [60, 60, 60],
  },
  already: {
    notes: [
      { freq: 587, at: 0, length: 70, wave: 'triangle', gain: 0.3 },
      { freq: 587, at: 120, length: 70, wave: 'triangle', gain: 0.3 },
    ],
    vibrate: [30, 70, 30],
  },
  archived: {
    notes: [{ freq: 330, at: 0, length: 230, wave: 'sine', gain: 0.3 }],
    vibrate: 120,
  },
  unknown: {
    notes: [
      { freq: 200, at: 0, length: 130, wave: 'square', gain: 0.12 },
      { freq: 200, at: 180, length: 130, wave: 'square', gain: 0.12 },
    ],
    vibrate: [80, 60, 80],
  },
  foreign: {
    notes: [{ freq: 300, at: 0, length: 50, wave: 'triangle', gain: 0.25 }],
    vibrate: 25,
  },
  error: {
    notes: [
      { freq: 260, at: 0, length: 140, wave: 'square', gain: 0.12 },
      { freq: 220, at: 180, length: 140, wave: 'square', gain: 0.12 },
      { freq: 180, at: 360, length: 220, wave: 'square', gain: 0.12 },
    ],
    vibrate: [120, 60, 120, 60, 120],
  },
};

/** The two things feedback needs from the browser, so a test can hand in fakes. */
export type FeedbackPorts = {
  /** The audio context, or null where there is none. Created on first use. */
  context: () => AudioContext | null;
  /** `navigator.vibrate`, or null where the device has none (iOS). */
  vibrate: () => ((pattern: number | number[]) => boolean) | null;
};

export type PlayOptions = { sound?: boolean; haptic?: boolean };

/** A tone must start and end at silence, or it clicks. */
const attackSeconds = 0.005;
const releaseSeconds = 0.02;

function schedule(context: AudioContext, notes: readonly Note[]) {
  const origin = context.currentTime;
  for (const note of notes) {
    const start = origin + note.at / 1000;
    const end = start + note.length / 1000;
    const release = Math.min(releaseSeconds, note.length / 2000);
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = note.wave;
    oscillator.frequency.value = note.freq;
    volume.gain.setValueAtTime(0, start);
    volume.gain.linearRampToValueAtTime(note.gain, start + attackSeconds);
    volume.gain.setValueAtTime(note.gain, end - release);
    volume.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(volume);
    volume.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  }
}

/**
 * The feedback of the scanner. `unlock` is for a user gesture: browsers (iOS above all) keep audio
 * suspended until one, and a scan arrives with no gesture of its own. Nothing here may throw:
 * a device that cannot beep or buzz must still scan.
 */
export function createFeedback(ports: FeedbackPorts) {
  const ready = (context: AudioContext) => context.state === 'running';

  const unlock = () => {
    try {
      const context = ports.context();
      if (context && !ready(context)) void context.resume().catch(() => {});
    } catch {
      // No audio on this device.
    }
  };

  const play = (kind: FeedbackKind, { sound = true, haptic = true }: PlayOptions = {}) => {
    const pattern = patterns[kind];
    if (haptic) {
      try {
        ports.vibrate()?.(pattern.vibrate as number | number[]);
      } catch {
        // A browser that refuses to vibrate (no user activation yet) is not an error.
      }
    }
    if (!sound) return;
    try {
      const context = ports.context();
      if (!context) return;
      if (ready(context)) {
        schedule(context, pattern.notes);
      } else {
        // Suspended (not unlocked yet, or the app was in the background): wake it, then play.
        void context
          .resume()
          .then(() => ready(context) && schedule(context, pattern.notes))
          .catch(() => {});
      }
    } catch {
      // No audio on this device.
    }
  };

  return { play, unlock };
}

let shared: { ctor: typeof AudioContext; context: AudioContext } | null = null;

/** One context for the whole app: the browser allows few, and it is unlocked once per page. */
function browserContext(): AudioContext | null {
  const Ctor = typeof window === 'undefined' ? undefined : window.AudioContext;
  if (!Ctor) return null;
  if (shared?.ctor !== Ctor) shared = { ctor: Ctor, context: new Ctor() };
  return shared.context;
}

function browserVibrate() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
    ? (pattern: number | number[]) => navigator.vibrate(pattern)
    : null;
}

/** The feedback of the real device. */
export const browserFeedback = createFeedback({ context: browserContext, vibrate: browserVibrate });
