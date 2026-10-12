import { useCallback, useEffect, useRef, useState } from 'react';
import { browserFeedback, type FeedbackKind } from './feedback';

const STORAGE_KEY = 'scanner-sound';

// Per-device convenience only: the screen works the same when storage is blocked.
function readSoundOn() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeSoundOn(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered; it still holds for this visit.
  }
}

/**
 * Sound and vibration for the scanner's results. The sound can be switched off (and stays off on
 * this device); the vibration cannot, it makes no noise. Audio is unlocked by the first touch or key
 * on the screen and again when the app comes back to the foreground, since browsers suspend it.
 */
export function useScanFeedback(feedback = browserFeedback) {
  const [soundOn, setSoundOn] = useState(readSoundOn);
  const sound = useRef(soundOn);

  useEffect(() => {
    const unlock = () => feedback.unlock();
    const onVisible = () => document.visibilityState === 'visible' && feedback.unlock();
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [feedback]);

  const play = useCallback((kind: FeedbackKind) => feedback.play(kind, { sound: sound.current }), [feedback]);

  const toggleSound = useCallback(() => {
    const next = !sound.current;
    sound.current = next;
    setSoundOn(next);
    writeSoundOn(next);
    // Switching it on lets the person hear that it works; switching it off is silent by definition.
    if (next) feedback.play('found', { haptic: false });
  }, [feedback]);

  return { play, soundOn, toggleSound };
}
