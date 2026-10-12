import type { InventoryRowDto } from '@inventory/shared';
import { describe, expect, it, vi } from 'vitest';
import { feedbackOf, type Sheet } from '../src/features/inventories/scan-sheet.tsx';
import { createFeedback, type FeedbackKind, patterns } from '../src/features/scanner/feedback.ts';
import { inventoryRow } from './fixtures.ts';

const kinds = Object.keys(patterns) as FeedbackKind[];

type FakeOscillator = {
  type: string;
  frequency: { value: number };
  startedAt?: number;
  stoppedAt?: number;
  connect: () => void;
  start: (when: number) => void;
  stop: (when: number) => void;
};

/** An audio context that only remembers the tones that were scheduled on it. */
function fakeContext(initial: 'running' | 'suspended' = 'running') {
  const oscillators: FakeOscillator[] = [];
  const context = {
    state: initial as string,
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    createOscillator() {
      const oscillator: FakeOscillator = {
        type: 'sine',
        frequency: { value: 0 },
        connect: () => {},
        start: (when) => {
          oscillator.startedAt = when;
        },
        stop: (when) => {
          oscillator.stoppedAt = when;
        },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => ({ gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} }),
  };
  return { context: context as unknown as AudioContext, fake: context, oscillators };
}

function setup(initial: 'running' | 'suspended' = 'running') {
  const audio = fakeContext(initial);
  const vibrate = vi.fn((_pattern: number | number[]) => true);
  const feedback = createFeedback({ context: () => audio.context, vibrate: () => vibrate });
  return { ...audio, vibrate, feedback };
}

describe('createFeedback', () => {
  it.each(kinds)('plays the tones and the vibration of "%s"', (kind) => {
    const { feedback, oscillators, vibrate } = setup();
    feedback.play(kind);

    const { notes, vibrate: pattern } = patterns[kind];
    expect(oscillators.map((o) => o.frequency.value)).toEqual(notes.map((note) => note.freq));
    expect(oscillators.map((o) => o.type)).toEqual(notes.map((note) => note.wave));
    expect(oscillators.map((o) => o.startedAt)).toEqual(notes.map((note) => 10 + note.at / 1000));
    for (const [index, oscillator] of oscillators.entries()) {
      expect(oscillator.stoppedAt).toBeGreaterThan(oscillator.startedAt as number);
      expect(notes[index]?.length).toBeGreaterThan(0);
    }
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(pattern);
  });

  it('makes every kind of result distinguishable, by ear and by hand', () => {
    const sound = kinds.map((kind) => JSON.stringify(patterns[kind].notes));
    const touch = kinds.map((kind) => JSON.stringify(patterns[kind].vibrate));
    expect(new Set(sound).size).toBe(kinds.length);
    expect(new Set(touch).size).toBe(kinds.length);
  });

  it('keeps good results rising and results that need a look falling', () => {
    const freqs = (kind: FeedbackKind) => patterns[kind].notes.map((note) => note.freq);
    const rising = (list: number[]) => list.every((f, i) => i === 0 || f > (list[i - 1] as number));
    const falling = (list: number[]) => list.every((f, i) => i === 0 || f < (list[i - 1] as number));
    expect(rising(freqs('recovered'))).toBe(true);
    expect(falling(freqs('elsewhere'))).toBe(true);
    expect(falling(freqs('error'))).toBe(true);
  });

  it('is silent but still vibrates when the sound is off, and the other way round', () => {
    const { feedback, oscillators, vibrate } = setup();
    feedback.play('found', { sound: false });
    expect(oscillators).toHaveLength(0);
    expect(vibrate).toHaveBeenCalledTimes(1);

    feedback.play('found', { haptic: false });
    expect(oscillators).toHaveLength(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('wakes a suspended context before it plays', async () => {
    const { feedback, fake, oscillators } = setup('suspended');
    feedback.play('already');
    expect(fake.resume).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(oscillators).toHaveLength(patterns.already.notes.length));
  });

  it('plays nothing when the context cannot be woken, and does not throw', async () => {
    const { feedback, fake, oscillators, vibrate } = setup('suspended');
    fake.resume.mockRejectedValue(new Error('no gesture'));
    expect(() => feedback.play('found')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(oscillators).toHaveLength(0);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('unlock wakes a suspended context and leaves a running one alone', () => {
    const suspended = setup('suspended');
    suspended.feedback.unlock();
    expect(suspended.fake.resume).toHaveBeenCalledOnce();

    const running = setup();
    running.feedback.unlock();
    expect(running.fake.resume).not.toHaveBeenCalled();
  });

  it('copes with a device that has no audio or no vibration, or that refuses either', () => {
    const none = createFeedback({ context: () => null, vibrate: () => null });
    expect(() => none.play('error')).not.toThrow();
    expect(() => none.unlock()).not.toThrow();

    const broken = createFeedback({
      context: () => {
        throw new Error('no audio');
      },
      vibrate: () => () => {
        throw new Error('not allowed');
      },
    });
    expect(() => broken.play('error')).not.toThrow();
    expect(() => broken.unlock()).not.toThrow();
  });
});

describe('feedbackOf', () => {
  const item = { id: 'a3b3d4a6-5d3f-4d57-9f5c-6f1b0e2e7a10', code: 'INV-00042', name: 'Kávovar', path: [] };
  const row = inventoryRow() as InventoryRowDto;
  const sheets: [string, Sheet, FeedbackKind][] = [
    ['a plain find', { kind: 'found', item, misplaced: false, wasMissing: false }, 'found'],
    ['a find that was missing', { kind: 'found', item, misplaced: false, wasMissing: true }, 'recovered'],
    ['a find in the wrong place', { kind: 'found', item, misplaced: true, wasMissing: false }, 'elsewhere'],
    ['a find that was missing, in the wrong place', { kind: 'found', item, misplaced: true, wasMissing: true }, 'elsewhere'],
    ['an item found elsewhere', { kind: 'elsewhere', item, wasMissing: false }, 'elsewhere'],
    ['an item already checked', { kind: 'already', item, row }, 'already'],
    ['an archived item', { kind: 'archived', item }, 'archived'],
    ['an unknown code', { kind: 'unknown', code: 'INV-NOPE' }, 'unknown'],
    ['a foreign code', { kind: 'foreign' }, 'foreign'],
    ['a failed scan', { kind: 'error', message: 'x', retry: true, ended: false }, 'error'],
  ];

  it.each(sheets)('gives %s the feedback "%s"', (_name, sheet, expected) => {
    expect(feedbackOf(sheet)).toBe(expected);
  });
});
